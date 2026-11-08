/**
 * Script de validación rápida: Sponsored Reserves.
 * `npm run sponsored`
 *
 * Crea wallet A sin Friendbot ni Sozu: el sponsor paga el reserve de la cuenta
 * y el reserve de la trustline USDC. Luego envía 1 XLM de A → B con fee-bump
 * (el sponsor también paga la comisión de red).
 *
 * Variables de entorno requeridas:
 *   SPONSOR_SECRET_KEY — cuenta sponsor con XLM en Testnet.
 */
import {
  Keypair,
  Networks,
  Asset,
  TransactionBuilder,
  Horizon,
  Operation,
} from '@stellar/stellar-sdk';
import { StellarSponsoredWalletProvider } from '../infrastructure/stellar/StellarSponsoredWalletProvider';
import { StellarPaymentSubmitter } from '../infrastructure/stellar/StellarPaymentSubmitter';
import { CreateFundedWallet } from '../application/use-cases/CreateFundedWallet';
import { SendSponsoredPayment } from '../application/use-cases/SendSponsoredPayment';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

async function buildAndSignPayment(
  fromSecret: string,
  fromAddress: string,
  toAddress: string,
  amount: string,
  asset: Asset,
): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const sourceKeypair = Keypair.fromSecret(fromSecret);
  const sourceAccount = await server.loadAccount(fromAddress);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: toAddress,
        asset,
        amount,
      }),
    )
    .setTimeout(300)
    .build();

  transaction.sign(sourceKeypair);
  return transaction.toXDR();
}

async function waitForAccount(
  server: Horizon.Server,
  address: string,
): Promise<Horizon.AccountResponse> {
  let account: Horizon.AccountResponse | undefined;
  for (let i = 0; i < 30; i++) {
    try {
      account = await server.loadAccount(address);
      return account;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`La cuenta ${address} no apareció en Horizon`);
}

async function main() {
  const sponsorSecret = requireEnv('SPONSOR_SECRET_KEY');

  // 1. Wallet A vía Sponsored Reserves (sin Friendbot, sin Sozu).
  const sponsoredProvider = new StellarSponsoredWalletProvider(
    sponsorSecret,
    HORIZON_URL,
  );
  const createWalletUseCase = new CreateFundedWallet(sponsoredProvider);

  console.log('🔹 Creando wallet A vía Sponsored Reserves…');
  const walletA = await createWalletUseCase.execute();
  console.log(`   Dirección A: ${walletA.address}`);
  if (!walletA.secret) {
    throw new Error('Wallet A no devolvió secret');
  }

  // Wallet A tiene 0 XLM disponibles (mínimo balance bloqueado). El sponsor le
  // envía un poco de XLM para que pueda pagar comisiones de transacciones internas.
  console.log('🔹 Sponsor fondea a A con 2 XLM para comisiones…');
  const server = new Horizon.Server(HORIZON_URL);
  const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
  const sponsorAccount = await server.loadAccount(sponsorKeypair.publicKey());
  const fundTx = new TransactionBuilder(sponsorAccount, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: walletA.address,
        asset: Asset.native(),
        amount: '2',
      }),
    )
    .setTimeout(300)
    .build();
  fundTx.sign(sponsorKeypair);
  await server.submitTransaction(fundTx);
  console.log('   ✅ Wallet A tiene 2 XLM disponibles para comisiones.');

  // 2. Wallet B (destinatario): Friendbot + trustline USDC.
  console.log('🔹 Creando y fondando wallet B (destinatario)…');
  const walletB = Keypair.random();
  console.log(`   Dirección B: ${walletB.publicKey()}`);

  await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(
      walletB.publicKey(),
    )}`,
  );
  const bAccount = await waitForAccount(server, walletB.publicKey());

  const trustlineTx = new TransactionBuilder(bAccount, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  trustlineTx.sign(walletB);
  await server.submitTransaction(trustlineTx);
  console.log('   Trustline USDC añadida a B.');

  // 3. Pago XLM de A → B firmado por A (USDC no tiene balance en A, usamos XLM nativo).
  console.log('🔹 Construyendo y firmando pago XLM de A → B…');
  const txXdr = await buildAndSignPayment(
    walletA.secret,
    walletA.address,
    walletB.publicKey(),
    '1', // 1 XLM
    Asset.native(),
  );
  console.log(`   XDR firmado por A (${txXdr.length} bytes).`);

  // 4. Fee-bump: el sponsor paga la comisión de red.
  console.log('🔹 Enviando pago patrocinado (fee-bump)…');
  const submitter = new StellarPaymentSubmitter(sponsorSecret, HORIZON_URL);
  const sendPayment = new SendSponsoredPayment(submitter);
  const hash = await sendPayment.execute(txXdr);

  console.log('\n✅ Transacción enviada con éxito.');
  console.log(`   Hash: ${hash}`);
  console.log(`   Explorador: https://stellar.expert/explorer/testnet/tx/${hash}`);
}

main().catch((err) => {
  const detail: any = err.response?.data ?? err.response?.extras ?? err.message;
  console.error('❌ Sponsored falló con detalle:', JSON.stringify(detail, null, 2));
  process.exit(1);
});
