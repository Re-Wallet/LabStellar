import { exec } from 'child_process';
import { promisify } from 'util';
import { Wallet } from '../../domain/Wallet';
import { WalletProvider } from '../../application/ports/WalletProvider';

const execAsync = promisify(exec);

/**
 * Opciones configurables para el adaptador SozuWalletProvider.
 */
export interface SozuWalletProviderOptions {
  /** Número máximo de reintentos (por defecto: 3). */
  maxRetries?: number;
  /** Retraso base en milisegundos para backoff exponencial (por defecto: 5000). */
  baseDelayMs?: number;
}

/**
 * Errores reconocidos del faucet Sozu que pueden recuperarse con reintentos.
 */
const RETRYABLE_ERROR_REASONS = new Set([
  'user_cooldown',
  'global_cooldown',
  'rate_limited',
]);

/**
 * Adaptador de infraestructura: proveedor de wallets vía Sozu Faucet CLI.
 *
 * Ejecuta `npx @sozu/faucet claim` que, sin dirección, genera una wallet G…,
 * la fondea con Friendbot, le añade la trustline de USDC y reclama USDC del
 * faucet. El JSON de salida incluye `wallet = { address, secret }`.
 *
 * Implementa reintentos con backoff exponencial para errores recuperables del
 * faucet (cooldowns de usuario, cooldowns globales, rate limiting HTTP 429).
 *
 * `runCommand` es inyectable para pruebas sin red (por defecto usa child_process).
 */
export class SozuWalletProvider implements WalletProvider {
  constructor(
    private readonly runCommand?: (cmd: string) => Promise<string>,
    private readonly options: SozuWalletProviderOptions = {},
  ) {}

  private get maxRetries(): number {
    return this.options.maxRetries ?? 3;
  }

  private get baseDelayMs(): number {
    return this.options.baseDelayMs ?? 5_000;
  }

  async createWallet(): Promise<Wallet> {
    const run = this.runCommand ?? (async (cmd: string) => {
      const { stdout } = await execAsync(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300_000, // 5 min (PoW + claim)
      });
      return stdout;
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const stdout = await run('npx @sozu/faucet claim');
        const json = this.parseJson(stdout);

        const wallet = json?.wallet;
        if (!wallet || !wallet.address) {
          // Si el faucet devolvió un error de cooldown en el JSON, intentamos de nuevo.
          const cooldownMs = this.extractCooldownMs(json);
          if (cooldownMs && attempt < this.maxRetries) {
            await this.sleep(cooldownMs);
            continue;
          }
          throw new Error(
            `Sozu faucet no devolvió una wallet. Respuesta: ${JSON.stringify(json)}`,
          );
        }

        return new Wallet(wallet.address, wallet.secret);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Si es un error de red/HTTP 429, podemos reintentar.
        if (this.isRetryableError(lastError) && attempt < this.maxRetries) {
          const delayMs = this.calculateDelay(attempt);
          await this.sleep(delayMs);
          continue;
        }

        // No es recuperable o se agotaron los reintentos.
        throw lastError;
      }
    }

    // Nunca deberíamos llegar aquí, pero por seguridad:
    throw lastError ?? new Error('Sozu faucet falló después de agotar los reintentos.');
  }

  /**
   * Extrae el tiempo de espera (ms) desde la respuesta JSON del faucet si
   * indica un cooldown (nextAvailableAt).
   */
  private extractCooldownMs(json: any): number | null {
    if (!json || typeof json !== 'object') {
      return null;
    }

    const reason = json?.reason;
    if (!RETRYABLE_ERROR_REASONS.has(reason)) {
      return null;
    }

    const nextAvailableAt = json?.nextAvailableAt;
    if (!nextAvailableAt) {
      // No hay timestamp específico; usamos el delay por defecto.
      return null;
    }

    const now = Date.now();
    const target = new Date(nextAvailableAt).getTime();
    const diffMs = target - now;

    return diffMs > 0 ? diffMs : 0;
  }

  /**
   * Determina si un error es recuperable mediante reintento.
   * Cubre errores de red (ECONNREFUSED, ETIMEDOUT, etc.) y HTTP 429.
   */
  private isRetryableError(err: Error): boolean {
    const message = err.message.toLowerCase();

    // Códigos de error de Node.js comunes en fallos de red.
    const retryableCodes = [
      'econnrefused',
      'econnreset',
      'enetunreach',
      'econnaborted',
      'etimedout',
      'eai_again',
    ];
    if (retryableCodes.some((code) => message.includes(code.toLowerCase()))) {
      return true;
    }

    // HTTP 429 Too Many Requests.
    if (message.includes('429') || message.includes('too many requests')) {
      return true;
    }

    return false;
  }

  /**
   * Calcula el delay antes del próximo reintento con backoff exponencial.
   */
  private calculateDelay(attempt: number): number {
    // Backoff exponencial: baseDelay * 2^attempt.
    const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);

    // Tope máximo de 60 segundos.
    return Math.min(exponentialDelay, 60_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
