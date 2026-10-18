/**
 * Processamento assíncrono de uma versão de arquivo (miniatura, dimensões).
 * Chamado pelo worker ao consumir o evento `file.version_uploaded`.
 * Implementação: módulo de arquivos.
 */
export async function processFileVersion(organizationId: string, fileVersionId: string): Promise<void> {
  void organizationId;
  void fileVersionId;
}
