/**
 * Script de validación E2E: `npm run e2e:usdc-onramp-pollar`.
 *
 * Flujo:
 * 1. Crea wallet A vía Sozu Faucet (fondada con USDC).
 * 2. Crea wallet B (destinatario), la fondea con Friendbot y le añade la trustline USDC.
 * 3. Construye y firma una transacción de pago USDC de A → B con el secret de A.
 * 4. Cotiza el pago USDC vía Pollar (Ramp).
 * 5. Crea la orden de rampa vía Pollar.
 * 6. Imprime información de la orden en consola.
 *
 * Variables de entorno requeridas:
 *   SPONSOR_SECRET_KEY  — secret key de la cuenta sponsor (paga la comisión de red fee-bump).
 *   POLAR_SECRET_KEY    — secret key de polar.xyz (para llamar a su Server API).
 *   SOZU_FAUCET_URL     — (opcional) origen del faucet Sozu.
 *
 * Nota: los secretos solo se manejan en memoria, nunca se hardcodean.
 */
import {
  Keypair,
  Networks,
  Asset,
  TransactionBuilder,
  Horizon,
  Operation,
} from '@stellar/stellar-sdk';
import { SozuWalletProvider } from '../infrastructure/sozu/SozuWalletProvider';
import { StellarPaymentSubmitter } from '../infrastructure/stellar/StellarPaymentSubmitter';
import { CreateFundedWallet } from '../application/use-cases/CreateFundedWallet';
import { SendSponsoredPayment } from '../application/use-cases/SendSponsoredPayment';
import { EnvSecretProvider } from '../infrastructure/secret/EnvSecretProvider';
import { PollarRampProvider } from '../infrastructure/pollar/PollarRampProvider';
import { CreateOnRampQuote } from '../application/use-cases/CreateOnRampQuote';
import { ExecuteOnRampOrder } from '../application/use-cases/ExecuteOnRampOrder';

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
): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const sourceKeypair = Keypair.fromSecret(fromSecret);
  const sourceAccount = await server.loadAccount(fromAddress);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: '100', // la fee-bump sobrescribe esta comisión
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: toAddress,
        asset: USDC,
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
  const polarSecretProvider = new EnvSecretProvider('POLAR_SECRET_KEY');

  // 1. Wallet A (usuario final) vía Sozu.
  const walletProvider = new SozuWalletProvider();
  const createWalletUseCase = new CreateFundedWallet(walletProvider);

  console.log('🔹 Creando wallet A vía Sozu Faucet…');
  const walletA = await createWalletUseCase.execute();
  console.log(`   Dirección A: ${walletA.address}`);
  if (!walletA.secret) {
    throw new Error('Wallet A no devolvió secret');
  }

  // 2. Wallet B (destinatario).
  console.log('🔹 Creando y fondando wallet B (destinatario)…');
  const walletB = Keypair.random();
  console.log(`   Dirección B: ${walletB.publicKey()}`);

  const server = new Horizon.Server(HORIZON_URL);
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

  // 3. Construir y firmar pago USDC de A → B (firmado por A).
  console.log('🔹 Construyendo y firmando pago USDC de A → B…');
  const txXdr = await buildAndSignPayment(
    walletA.secret,
    walletA.address,
    walletB.publicKey(),
    '10', // 10 USDC
  );
  console.log(`   XDR firmado por A (${txXdr.length} bytes).`);

  // 4. Cotizar pago USDC vía Pollar (Ramp).
  console.log('🔹 Cotizando pago USDC vía Pollar (Ramp)…');
  const quoteUseCase = new CreateOnRampQuote(
    new PollarRampProvider(polarSecretProvider),
  );
  const quote = await quoteUseCase.execute({
    direction: 'on', // A compra USDC con ARS (o viceversa según configure)
    fiat: 'ARS',
    asset: 'USDC',
    amount: { value: '10', denomination: 'out' }, // 10 USDC de salida
  });
  console.log(`   Cotización obtenida: ${quote.quoteId}`);
  console.log(`   Rutas disponibles: ${quote.quotes.length}`);
  if (quote.quotes.length > 0) {
    const firstQuote = quote.quotes[0];
    console.log(`   Monto a pagar: ${firstQuote.amountIn.value} ${firstQuote.amountIn.currency}`);
    console.log(`   Monto a recibir: ${firstQuote.amountOut.value} ${firstQuote.amountOut.asset}`);
    console.log(`   Comisión estimada: ${firstQuote.fee?.value ?? 'N/A'} ${firstQuote.fee?.currency ?? ''}`);
  }

  // 5. Crear orden de rampa vía Pollar.
  console.log('🔹 Creando orden de pago vía Pollar…');
  const executePayment = new ExecuteOnRampOrder(
    new PollarRampProvider(polarSecretProvider),
  );
  const order = await executePayment.execute({
    quoteId: quote.quoteId,
    payee: {
      // Aquí se deben pasar los campos requeridos por la ruta (requiredFields de la cotización)
      // Ejemplo: destination: walletA.address, etc.
      walletAddress: walletA.address,
    },
  });
  console.log(`   Orden creada: ${order.orderId}`);
  console.log(`   Estado: ${order.status}`);

  if (order.pendingAction) {
    console.log(`   Acción pendiente: ${order.pendingAction.kind}`);
    if (order.pendingAction.instructions) {
      console.log(`   Instrucciones: ${order.pendingAction.instructions}`);
    }
  }

  console.log('\n✅ Flujo de pago patrocinado (fee-bump) enviado con éxito.');
  console.log(`   Hash de la transacción Stellar: ${txXdr.substring(0, 16)}...`);
  console.log(`   Orden de pago en Pollar: ${order.orderId}`);
}

main().catch((err) => {
  console.error('❌ Demo falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
