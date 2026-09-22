/**
 * Late-bound singletons. The player and realtime layers are created during bootstrap and are
 * needed by services that are imported before bootstrap finishes, so they are registered here
 * instead of being passed through every call site.
 */
export const runtime = {
  player: null,
  realtime: null,
  folderImporter: null,
  logger: console
};

export function setRuntime(values) {
  Object.assign(runtime, values);
}
