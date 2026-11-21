export async function encodeQuestionMedia(records = []) {
  return Promise.all(records.map(async (record) => {
    if (!(record.blob instanceof Blob)) return { ...record };
    return {
      ...record,
      blob: {
        __neuronetBlob: true,
        type: record.blob.type || "application/octet-stream",
        bytes: Array.from(new Uint8Array(await record.blob.arrayBuffer()))
      }
    };
  }));
}

export function decodeQuestionMedia(records = []) {
  return records.map((record) => record.blob?.__neuronetBlob
    ? { ...record, blob: new Blob([new Uint8Array(record.blob.bytes)], { type: record.blob.type || "application/octet-stream" }) }
    : { ...record });
}
