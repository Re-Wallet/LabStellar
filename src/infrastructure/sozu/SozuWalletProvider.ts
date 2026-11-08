import { exec } from 'child_process';
import { promisify } from 'util';
import { Wallet } from '../../domain/Wallet';
import { WalletProvider } from '../../application/ports/WalletProvider';

const execAsync = promisify(exec);

/**
 * Adaptador de infraestructura: proveedor de wallets vía Sozu Faucet CLI.
 *
 * Ejecuta `npx @sozu/faucet claim` que, sin dirección, genera una wallet G…,
 * la fondea con Friendbot, le añade la trustline de USDC y reclama USDC del
 * faucet. El JSON de salida incluye `wallet = { address, secret }`.
 *
 * `runCommand` es inyectable para pruebas sin red (por defecto usa child_process).
 */
export class SozuWalletProvider implements WalletProvider {
  constructor(private readonly runCommand?: (cmd: string) => Promise<string>) {}

  async createWallet(): Promise<Wallet> {
    const run = this.runCommand ?? (async (cmd: string) => {
      const { stdout } = await execAsync(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300_000, // 5 min (PoW + claim)
      });
      return stdout;
    });

    const stdout = await run('npx @sozu/faucet claim');
    const json = this.parseJson(stdout);

    const wallet = json?.wallet;
    if (!wallet || !wallet.address) {
      throw new Error(
        `Sozu faucet no devolvió una wallet. Respuesta: ${JSON.stringify(json)}`,
      );
    }

    return new Wallet(wallet.address, wallet.secret);
  }

  private parseJson(stdout: string): any {
    const trimmed = stdout.trim();
    const start = trimmed.indexOf('{');
    if (start === -1) {
      throw new Error(`No se encontró JSON en la salida de sozu-faucet: ${trimmed}`);
    }
    try {
      return JSON.parse(trimmed.slice(start));
    } catch (err) {
      throw new Error(
        `No se pudo parsear la salida JSON de sozu-faucet: ${trimmed.slice(start, start + 200)}`,
      );
    }
  }
}
