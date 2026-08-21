/**
 * Upserts fields into the one MongoDB document owned by both chronological
 * history and semantic enrichment. Concurrent first writes can race on the
 * unique event-id index; retry the losing writer as an ordinary update.
 */
export async function upsertMongoEventFields(collection, eventId, fields) {
  if (!collection || typeof collection.updateOne !== "function") {
    throw new TypeError("A MongoDB event collection is required");
  }
  if (!eventId) throw new TypeError("A stable event id is required");

  const update = {
    $set: {
      ...fields,
      id: eventId,
    },
  };

  try {
    return await collection.updateOne(
      { id: eventId },
      update,
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const retried = await collection.updateOne(
      { id: eventId },
      update,
      { upsert: false },
    );
    if (!retried?.acknowledged || retried.matchedCount < 1) throw error;
    return retried;
  }
}
