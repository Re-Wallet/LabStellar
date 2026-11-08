import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * Script de utilidad para crear el archivo cifrado de secretos.
 *
 * Uso:
 *   MASTER_SECRET_KEY=mi_clave_maestra_de_64_chars_hex SPONSOR_SECRET_KEY=SA_... npx ts-node src/infrastructure/secret/encrypt-secret.ts
 *
 * Genera el archivo .sponsor-secret.enc que puede ser leído por
 * EncryptedFileSecretProvider.
 *
 * NO commitear el archivo .sponsor-secret.enc al repositorio.
 */
const masterKeyHex = process.env.MASTER_SECRET_KEY;
const secret = process.env.SPONSOR_SECRET_KEY;

if (!masterKeyHex || !secret) {
  console.error(
    'Error: Debes definir MASTER_SECRET_KEY y SPONSOR_SECRET_KEY antes de ejecutar este script',
  );
  console.error(
    'Ejemplo: MASTER_SECRET_KEY=abc123... SPONSOR_SECRET_KEY=SA_... npx ts-node src/infrastructure/secret/encrypt-secret.ts',
  );
  process.exit(1);
}

if (masterKeyHex.length !== 64) {
  console.error(
    `Error: MASTER_SECRET_KEY debe tener exactamente 64 caracteres hexadecimales (256 bits). Actualmente tiene ${masterKeyHex.length}`,
  );
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
  console.error(
    'Error: MASTER_SECRET_KEY debe contener solo caracteres hexadecimales (0-9, a-f)',
  );
  process.exit(1);
}

if (!secret.startsWith('S') || secret.length !== 56) {
  console.error(
    `Error: SPONSOR_SECRET_KEY debe ser una clave secreta Stellar válida (empieza con 'S', 56 caracteres). Actualmente tiene ${secret.length} caracteres`,
  );
  process.exit(1);
}

const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv(
  'aes-256-gcm',
  Buffer.from(masterKeyHex, 'hex'),
  iv,
);
const encrypted = Buffer.concat([
  cipher.update(Buffer.from(secret, 'utf8')),
  cipher.final(),
]);

const payload = {
  iv: iv.toString('hex'),
  encryptedData: encrypted.toString('hex'),
  authTag: cipher.getAuthTag().toString('hex'),
};

fs.writeFileSync('.sponsor-secret.enc', JSON.stringify(payload, null, 2));
console.log('✓ Archivo .sponsor-secret.enc creado exitosamente');
console.log('  Recuerda agregar .sponsor-secret.enc a tu .gitignore');
