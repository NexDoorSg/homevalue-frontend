// Validation only: prevent build-time fetches from accessing live providers.
globalThis.fetch = async function () {
  throw new Error('Provider network disabled for validation');
};
