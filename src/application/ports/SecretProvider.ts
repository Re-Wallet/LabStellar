/**
 * Puerto de salida: proveedor de secretos.
 *
 * Permite obtener secretos sensibles (ej. la clave del sponsor que paga
 * comisiones de red vía fee-bump) sin que el dominio ni los casos de uso
 * conozcan el mecanismo de almacenamiento.
 *
 * Implementaciones posibles:
 *  - Variable de entorno (desarrollo rápido)
 *  - Archivo cifrado (producción ligera)
 *  - AWS Secrets Manager, HashiCorp Vault, etc. (producción empresarial)
 *
 * Regla de oro: este puerto nunca debe devolver secretos de usuarios finales
 * en un modelo no-custodial. Solo se usa para el secreto del sponsor que
 * patrocina las comisiones de red.
 */
export interface SecretProvider {
  /**
   * Obtiene la clave secreta Stellar del sponsor que paga las comisiones
   * de red (fee-bump).
   *
   * @returns La clave secreta (empieza con 'S', 56 caracteres).
   * @throws Si no se puede obtener el secreto.
   */
  getSponsorSecret(): Promise<string>;
}
