/** Loader-facing export for the optional Claude-compatible local LSP provider. */

export {
  apply,
  Config,
  inject,
  name,
  type ClaudeLspServers,
  type Config as LspProviderConfig,
} from './lsp-runtime.ts'
