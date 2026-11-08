/**
 * Script de validación E2E: `npm run e2e:xlm-sponsored-reserves-fee-bump`.
 *
 * Flujo:
 * 1. Crea wallet A vía Sponsored Reserves (sin Friendbot, sin Sozu).
 * 2. Crea wallet B (destinatario), la fondea con Friendbot y le añade la trustline USDC.
 * 3. Construye y firma una transacción de pago USDC de A → B con el secret de A.
 * 4. Paga el XDR firmado al StellarPaymentSubmitter (fee-bump pagado por el sponsor).
 * 5. Imprime el hash de la transacción en consola.
 *
 * Variables de entorno requeridas:
 *   SPONSOR_SECRET_KEY  — secret key de la cuenta sponsor (paga la comisión de red fee-bump).
 *   SOZU_FAUCET_URL     — (opcional) origen del faucet Sozu.
 *
 * Nota: los secretos solo se manejan en memoria, nunca se hardcodean.
 */
import { Keypair, Networks, Asset, TransactionBuilder, Horizon, Operation } from '@stellar/stellar-sdk';
import { SozuWalletProvider } from '../infrastructure/sozu/SozuWalletProvider';
import { StellarPaymentSubmitter } from '../infrastructure/stellar/StellarPaymentSubmitter';
import { CreateFundedWallet } from '../application/use-cases/CreateFundedWallet';
import { SendSponsoredPayment } from '../application/use-cases/SendSponsoredPayment';
import { EnvSecretProvider } from '../infrastructure/secret/EnvSecretProvider';
import { StellarSponsoredWalletProvider } from '../infrastructure/stellar/StellarSponsoredWalletProvider';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

async function buildAndSignPayment(fromSecret: string, fromAddress: string, toAddress: string, amount: string): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const sourceKeypair = Keypair.fromSecret(fromSecret);
  const sourceAccount = await server.loadAccount(fromAddress);

  const transaction = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: toAddress, asset: USDC, amount }))
    .setTimeout(300).build();

  transaction.sign(sourceKeypair);
  return transaction.toXDR();
}

async function waitForAccount(server: Horizon.Server, address: string): Promise<Horizon.AccountResponse> {
  let account: Horizon.AccountResponse | undefined;
  for (let i = 0; i < 30; i++) {
    try { account = await server.loadAccount(address); return account; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error(`La cuenta ${address} no apareció en Horizon`);
}

async function main() {
  const sponsorSecretProvider = new EnvSecretProvider('SPONSOR_SECRET_KEY');
  const sponsorSecret = await sponsorSecretProvider.getSponsorSecret();

  const sponsoredProvider = new StellarSponsoredWalletProvider(sponsorSecretProvider, HORIZON_URL);
  const createWalletUseCase = new CreateFundedWallet(sponsoredProvider);

  console.log('🔹 Creando wallet A vía Sponsored Reserves…');
  const walletA = await createWalletUseCase.execute();
  console.log(`   Dirección A: ${walletA.address}`);
  if (!walletA.secret) throw new Error('Wallet A no devolvió secret');

  console.log('🔹 Creando y fondando wallet B (destinatario)…');
  const walletB = Keypair.random();
  console.log(`   Dirección B: ${walletB.publicKey()}`);

  const server = new Horizon.Server(HORIZON_URL);
  await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(walletB.publicKey())}`);
  const bAccount = await waitForAccount(server, walletB.publicKey());

  const trustlineTx = new TransactionBuilder(bAccount, { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(Operation.changeTrust({ asset: USDC })).setTimeout(60).build();
  trustlineTx.sign(walletB);
  await server.submitTransaction(trustlineTx);
  console.log('   Trustline USDC añadida a B.');

  console.log('🔹 Construyendo y firmando pago USDC de A → B…');
  const txXdr = await buildAndSignPayment(walletA.secret, walletA.address, walletB.publicKey(), '1');
  console.log(`   XDR firmado por A (${txXdr.length} bytes).`);

  console.log('🔹 Enviando pago patrocinado (fee-bump)…');
  const submitter = new StellarPaymentSubmitter(sponsorSecret);
  const sendPayment = new SendSponsoredPayment(submitter);
  const hash = await sendPayment.execute(txXdr);

  console.log('\n✅ Transacción enviada con éxito.');
  console.log(`   Hash: ${hash}`);
  console.log(`   Explorador: https://stellar.expert/explorer/testnet/tx/${hash}`);
}

main().catch((err) => {
  console.error('❌ Demo falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
