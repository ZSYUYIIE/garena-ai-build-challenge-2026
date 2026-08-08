import { randomUUID } from "node:crypto";

import { MongoClient } from "mongodb";

import { dashboardAccountSchema, normalizeAccountDraft } from "./accountSchemas.js";
import { AccountRepository } from "./accountRepository.js";

const DEFAULT_DATABASE_NAME = "streamsense";
const COLLECTION_NAME = "dashboard_accounts";

export class MongoAccountRepository extends AccountRepository {
  static async connect({
    uri,
    databaseName = DEFAULT_DATABASE_NAME,
    clientOptions = {},
  }) {
    if (!uri?.trim()) throw new TypeError("MongoAccountRepository requires a MongoDB URI");
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5_000,
      ...clientOptions,
    });
    await client.connect();
    const repository = new MongoAccountRepository({
      collection: client.db(databaseName).collection(COLLECTION_NAME),
      closeClient: () => client.close(),
    });
    await repository.ensureIndexes();
    return repository;
  }

  constructor({
    collection,
    closeClient = () => {},
    now = () => new Date(),
    createId = randomUUID,
  }) {
    super();
    if (!collection) throw new TypeError("MongoAccountRepository requires a collection");
    this.collection = collection;
    this.closeClient = closeClient;
    this.now = now;
    this.createId = createId;
  }

  async ensureIndexes() {
    await Promise.all([
      this.collection.createIndex(
        { accountId: 1 },
        { unique: true, name: "account_id_unique" },
      ),
      this.collection.createIndex(
        { normalizedEmail: 1 },
        { unique: true, name: "normalized_email_unique" },
      ),
    ]);
  }

  async createAccount(input) {
    const draft = normalizeAccountDraft(input);
    const timestamp = this.now();
    const stored = {
      ...draft,
      version: 1,
      accountId: this.createId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      await this.collection.insertOne(stored);
    } catch (error) {
      throw translateMongoError(error);
    }
    return publicAccount(stored);
  }

  async getAccount(accountId) {
    const stored = await this.collection.findOne({ accountId });
    return stored ? publicAccount(stored) : null;
  }

  async updateAccount(accountId, input) {
    const draft = normalizeAccountDraft(input);
    let result;
    try {
      result = await this.collection.findOneAndUpdate(
        { accountId },
        {
          $set: {
            ...draft,
            updatedAt: this.now(),
          },
        },
        { returnDocument: "after" },
      );
    } catch (error) {
      throw translateMongoError(error);
    }
    return result ? publicAccount(result) : null;
  }

  close() {
    return this.closeClient();
  }
}

function publicAccount(stored) {
  const {
    _id: _mongoId,
    normalizedEmail: _normalizedEmail,
    createdAt,
    updatedAt,
    ...account
  } = stored;
  return dashboardAccountSchema.parse({
    ...account,
    createdAt: toIsoString(createdAt),
    updatedAt: toIsoString(updatedAt),
  });
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function translateMongoError(error) {
  if (error?.code === 11000) {
    const duplicate = new Error("An account already uses this email address.");
    duplicate.code = "ACCOUNT_EMAIL_EXISTS";
    return duplicate;
  }
  return error;
}
