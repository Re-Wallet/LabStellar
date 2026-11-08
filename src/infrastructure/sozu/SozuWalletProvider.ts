import { exec } from 'child_process';
import { promisify } from 'util';
import { Wallet } from '../../domain/Wallet';
import { WalletProvider } from '../../application/ports/WalletProvider';

const execAsync = promisify(exec);

export class SozuWalletProvider implements WalletProvider {
  constructor(private readonly runCommand?: (cmd: string) => Promise<string>) {}

  async createWallet(): Promise<Wallet> {
    const run = this.runCommand ?? (async (cmd: string) => {
      const { stdout } = await execAsync(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300_000,
      });
      return stdout;
    });

    const stdout = await run('npx @sozu/faucet claim');
    const json = this.parseJson(stdout);

    const wallet = json?.wallet;
    if (!wallet || !wallet.address) {
      throw new Error(`Sozu faucet no devolvió una wallet. Respuesta: ${JSON.stringify(json)}`);
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
    } catch {
      throw new Error(`No se pudo parsear la salida JSON de sozu-faucet: ${trimmed.slice(start, start + 200)}`);
    }
  }
}
