import * as fs from 'fs';
import * as crypto from 'crypto';
import { SecretProvider } from '../../application/ports/SecretProvider';

/**
 * Adaptador de infraestructura: proveedor de secretos desde un archivo cifrado.
 *
 * El archivo contiene el secreto cifrado con AES-256-GCM usando una contraseña
 * maestra provista vía variable de entorno MASTER_SECRET_KEY.
 *
 * Flujo de uso:
 * 1. Crear el archivo cifrado con el script de utilidad:
 *    MASTER_SECRET_KEY=mi_clave_maestra SPONSOR_SECRET_KEY=SA_... npx ts-node src/infrastructure/secret/encrypt-secret.ts
 * 2. Definir MASTER_SECRET_KEY en el entorno de producción.
 * 3. El adaptador lee el archivo, lo descifra y devuelve el secreto.
 *
 * El archivo .sponsor-secret.enc NO debe commitearse al repositorio.
 */
export class EncryptedFileSecretProvider implements SecretProvider {
  constructor(
    private readonly filePath: string = '.sponsor-secret.enc',
    private readonly masterKeyEnvVar: string = 'MASTER_SECRET_KEY',
  ) {}

  async getSponsorSecret(): Promise<string> {
    const masterKey = process.env[this.masterKeyEnvVar];
    if (!masterKey) {
      throw new Error(
        `Variable de entorno ${this.masterKeyEnvVar} no definida. Necesaria para descifrar el archivo ${this.filePath}`,
      );
    }

    let encrypted: string;
    try {
      encrypted = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      throw new Error(
        `No se pudo leer el archivo de secretos cifrados: ${this.filePath}`,
      );
    }

    let parsed: { iv: string; encryptedData: string; authTag: string };
    try {
      parsed = JSON.parse(encrypted);
    } catch {
      throw new Error(
        `El archivo ${this.filePath} no contiene JSON válido`,
      );
    }

    const { iv, encryptedData, authTag } = parsed;

    if (!iv || !encryptedData || !authTag) {
      throw new Error(
        `El archivo ${this.filePath} no contiene los campos requeridos (iv, encryptedData, authTag)`,
      );
    }

    let decipher: any;
    try {
      decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(masterKey, 'hex'),
        Buffer.from(iv, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    } catch {
      throw new Error(
        'No se pudo crear el descifrador. Verifica que MASTER_SECRET_KEY tenga 64 caracteres hexadecimales (256 bits)',
      );
    }

    let decrypted: Buffer;
    try {
      decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedData, 'hex')),
        decipher.final(),
      ]);
    } catch {
      throw new Error(
        'No se pudo descifrar el secreto. Verifica que MASTER_SECRET_KEY sea correcta y que el archivo no esté corrupto',
      );
    }

    return decrypted.toString('utf8').trim();
  }
}
