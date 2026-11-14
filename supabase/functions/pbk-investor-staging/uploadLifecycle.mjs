// Reserve before writing bytes. Failed cleanup leaves a durable reservation for retry.
export async function storePrivateAsset({ reserve, upload, attach, reconcile }) {
  await reserve();
  try {
    await upload();
    return await attach();
  } catch (error) {
    try {
      const committed = await reconcile();
      if (committed) return committed;
    } catch {
      error.message += ' The private file is queued for cleanup; retry later.';
    }
    throw error;
  }
}
