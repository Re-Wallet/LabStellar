import { SecretProvider } from '../../application/ports/SecretProvider';

/**
 * Adaptador de infraestructura: proveedor de secretos vía variable de entorno.
 *
 * Útil para desarrollo rápido y pruebas locales. El secreto se lee directamente
 * de process.env. NO usar en producción sin cifrado adicional, ya que el secreto
 * queda expuesto en la shell y en el entorno del proceso.
 */
export class EnvSecretProvider implements SecretProvider {
  constructor(private readonly envVarName: string = 'SPONSOR_SECRET_KEY') {}

  async getSponsorSecret(): Promise<string> {
    const secret = process.env[this.envVarName];
    if (!secret || secret.trim().length === 0) {
      throw new Error(`Variable de entorno ${this.envVarName} no definida`);
    }
    return secret.trim();
  }
}
