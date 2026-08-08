export class AccountRepository {
  createAccount(_draft) {
    throw new Error("AccountRepository.createAccount() is not implemented");
  }

  getAccount(_accountId) {
    throw new Error("AccountRepository.getAccount() is not implemented");
  }

  updateAccount(_accountId, _draft) {
    throw new Error("AccountRepository.updateAccount() is not implemented");
  }

  close() {}
}

export class UnavailableAccountRepository extends AccountRepository {
  createAccount() {
    throw unavailableError();
  }

  getAccount() {
    throw unavailableError();
  }

  updateAccount() {
    throw unavailableError();
  }
}

function unavailableError() {
  const error = new Error("MongoDB account storage is not configured.");
  error.code = "ACCOUNT_STORAGE_UNAVAILABLE";
  return error;
}
