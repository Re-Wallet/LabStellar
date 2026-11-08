/**
 * Script de validación: Sponsored Reserves + Pago USDC.
 * `npm run e2e:usdc-fee-bump-sponsored-reserves`
 *
 * Flujo:
 * 1. Crea wallet A vía Sponsored Reserves (CAP-33/CAP-31): sponsor paga el reserve
 *    de la cuenta (1 XLM) y el reserve de la trustline USDC (0.5 XLM).
 *    IMPORTANTE: A nace con 0 XLM gastables y 0 USDC balance.
 * 2. Fondea a A con 2 XLM para comisiones disponibles.
 * 3. Fondea a A con USDC (vía Sozu Faucet claim a dirección existente o pago directo).
 *    El usuario debe proveer USDC a A antes de este paso.
 * 4. Crea wallet B (Friendbot + trustline USDC).
 * 5. Paga USDC de A → B firmado por A.
 * 6. Sponsor paga la comisión de red vía fee-bump.
 *
 * Variables de entorno requeridas:
 *   SPONSOR_SECRET_KEY — cuenta sponsor con XLM en Testnet (virgen, sin patrocinios previos).
 *   SOZU_FAUCET_URL     — (opcional) origen del faucet Sozu.
 *
 * Nota: Para obtener USDC en wallet A, usar Sozu Faucet:
 *   npx @sozu/faucet claim <DIRECCION_DE_A>
 * O recibir USDC de otra wallet.
 *
 * Nunca hardcodear secretos.
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
import { EnvSecretProvider } from '../infrastructure/secret/EnvSecretProvider';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const SOZU_FAUCET_URL = 'https://faucet.sozu.capital';
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
  const sponsorSecretProvider = new EnvSecretProvider('SPONSOR_SECRET_KEY');

  // 1. Wallet A vía Sponsored Reserves (sin Friendbot, sin Sozu).
  const sponsoredProvider = new StellarSponsoredWalletProvider(
    sponsorSecretProvider,
    HORIZON_URL,
  );
  const createWalletUseCase = new CreateFundedWallet(sponsoredProvider);

  console.log('🔹 Creando wallet A vía Sponsored Reserves…');
  const walletA = await createWalletUseCase.execute();
  console.log(`   Dirección A: ${walletA.address}`);
  if (!walletA.secret) {
    throw new Error('Wallet A no devolvió secret');
  }

  // A nace con 0 XLM gastables y 0 USDC balance (solo tiene la trustline activa).
  // El sponsor le envía XLM para comisiones.
  console.log('🔹 Sponsor fondea a A con 2 XLM para comisiones…');
  const server = new Horizon.Server(HORIZON_URL);
  const sponsorSecret = await sponsorSecretProvider.getSponsorSecret();
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

  // 2. IMPORTANTE: Fondear A con USDC antes de poder pagar.
  //    Usar Sozu Faucet claim a la dirección de A:
  //    npx @sozu/faucet claim GA...DIRECCION_DE_A
  // O recibir USDC de otra wallet.
  console.log('');
  console.log('⚠️  PASO REQUERIDO: Fondear wallet A con USDC antes de continuar.');
  console.log(`   Ejecutar: npx @sozu/faucet claim ${walletA.address}`);
  console.log(`   O recibir USDC de otra wallet a: ${walletA.address}`);
  console.log('');

  // Esperar confirmación del usuario (en CI se puede saltar con SKIP_USDC_FUND=true)
  if (process.env.SKIP_USDC_FUND !== 'true') {
    console.log('   Presiona Enter cuando A tenga USDC balance…');
    await new Promise((resolve) => process.stdin.once('data', resolve));
  }

  // 3. Wallet B (destinatario): Friendbot + trustline USDC.
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

  // 4. Verificar que A tiene USDC balance antes de pagar.
  const aAccount = await server.loadAccount(walletA.address);
  const usdcBalance = (aAccount.balances ?? []).find(
    (b) =>
      b.asset_type === 'credit_alphanum4' &&
      b.asset_code === 'USDC' &&
      b.asset_issuer === USDC_ISSUER,
  );
  if (!usdcBalance || Number(usdcBalance.balance) < 1) {
    throw new Error(
      `Wallet A no tiene suficiente USDC balance (${usdcBalance?.balance ?? 0}). Fondear primero con USDC.`,
    );
  }
  console.log(`   ✅ Wallet A tiene ${usdcBalance.balance} USDC.`);

  // 5. Pago USDC de A → B firmado por A.
  console.log('🔹 Construyendo y firmando pago USDC de A → B…');
  const txXdr = await buildAndSignPayment(
    walletA.secret,
    walletA.address,
    walletB.publicKey(),
    '1', // 1 USDC
    USDC,
  );
  console.log(`   XDR firmado por A (${txXdr.length} bytes).`);

  // 6. Fee-bump: el sponsor paga la comisión de red.
  console.log('🔹 Enviando pago patrocinado (fee-bump)…');
  const submitter = new StellarPaymentSubmitter(sponsorSecretProvider, HORIZON_URL);
  const sendPayment = new SendSponsoredPayment(submitter);
  const hash = await sendPayment.execute(txXdr);

  console.log('\n✅ Transacción enviada con éxito.');
  console.log(`   Hash: ${hash}`);
  console.log(`   Explorador: https://stellar.expert/explorer/testnet/tx/${hash}`);
}

main().catch((err) => {
  const detail: any = err.response?.data ?? err.response?.extras ?? err.message;
  console.error('❌ Sponsored USDC falló con detalle:', JSON.stringify(detail, null, 2));
  process.exit(1);
});
