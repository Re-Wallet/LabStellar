import {
  Keypair,
  Networks,
  TransactionBuilder,
  Horizon,
  Operation,
  Asset,
} from '@stellar/stellar-sdk';
import { Wallet } from '../../domain/Wallet';
import { WalletProvider } from '../../application/ports/WalletProvider';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

/**
 * Adaptador de infraestructura: proveedor de wallets mediante Sponsored Reserves.
 *
 * Implementa el patrón "sponsored reserves sandwich" (CAP-33 / CAP-31) en una
 * sola transacción atómica envuelta en fee-bump:
 *
 * 1. beginSponsoringFutureReserves(sponsoredId = usuario) — firma sponsor
 * 2. createAccount(destino = usuario, startingBalance = 0) — firma sponsor
 * 3. changeTrust(USDC, source = usuario) — firma usuario
 * 4. endSponsoringFutureReserves — firma usuario
 *
 * El sponsor paga todos los reserves (cuenta + trustline) y la comisión de red
 * vía fee-bump. El usuario final nace con 0 XLM disponibles y ya tiene la
 * trustline USDC activa.
 *
 * Ideal para Mainnet donde no existe Friendbot.
 *
 * `horizon` es inyectable para pruebas sin red.
 */
export class StellarSponsoredWalletProvider implements WalletProvider {
  constructor(
    private readonly sponsorSecret: string,
    private readonly horizonUrl: string = 'https://horizon-testnet.stellar.org',
    private readonly networkPassphrase: string = Networks.TESTNET,
    private readonly horizon?: Horizon.Server,
  ) {
    this.validateSecret(sponsorSecret);
  }

  /**
   * Valida que la clave secreta tenga formato Stellar antes de usarla.
   * Evita errores crudos de la librería y da un mensaje claro al operador.
   */
  private validateSecret(secret: string): void {
    if (!secret || typeof secret !== 'string') {
      throw new Error(
        'Clave secreta Stellar inválida: no se proporcionó una clave secreta.',
      );
    }

    if (!secret.startsWith('S') || secret.length !== 56) {
      throw new Error(
        `Clave secreta Stellar inválida: debe empezar con 'S' y tener exactamente 56 caracteres. Recibido "${secret.slice(0, 6)}..." (${secret.length} caracteres).`,
      );
    }

    try {
      Keypair.fromSecret(secret);
    } catch {
      throw new Error(
        'Clave secreta Stellar inválida: la clave no pudo ser decodificada por el SDK Stellar. Verifica que no tenga espacios ni caracteres extra.',
      );
    }
  }

  async createWallet(): Promise<Wallet> {
    const server = this.horizon ?? new Horizon.Server(this.horizonUrl);
    const sponsor = Keypair.fromSecret(this.sponsorSecret);
    const user = Keypair.random();

    // Cargar cuenta del sponsor para obtener sequence
    const sponsorAccount = await server.loadAccount(sponsor.publicKey());

    // Construir la transacción interna con el sponsored reserves sandwich:
    // beginSponsoringFutureReserves + createAccount + changeTrust + endSponsoringFutureReserves
    const innerTransaction = new TransactionBuilder(sponsorAccount, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: user.publicKey(),
        }),
      )
      .addOperation(
        Operation.createAccount({
          destination: user.publicKey(),
          startingBalance: '0',
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: USDC,
          source: user.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: user.publicKey(),
        }),
      )
      .setTimeout(60)
      .build();

    // Firmar: sponsor firma beginSponsoringFutureReserves y createAccount
    innerTransaction.sign(sponsor);
    // Usuario firma changeTrust y endSponsoringFutureReserves
    innerTransaction.sign(user);

    // Envolver en fee-bump pagada por el sponsor
    const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      sponsor,
      '100',
      innerTransaction as any,
      this.networkPassphrase,
    );
    feeBumpTransaction.sign(sponsor);

    // Enviar a Horizon
    await server.submitTransaction(feeBumpTransaction as any);

    return new Wallet(user.publicKey(), user.secret());
  }
}
