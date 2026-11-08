/**
 * Script de validación E2E: `npm run e2e:usdc-offramp-pollar`.
 *
 * Flujo off-ramp (cripto → fiat) vía Pollar Server API v3.
 *
 * Arquitectura NO-CUSTODIAL: el usuario usa SU propia wallet Stellar.
 * Para que funcione, debes tener USDC en tu wallet y agregar los trustlines
 * de los activos de las rutas antes de ejecutar.
 *
 * Fuente: https://docs.pollar.xyz/docs/sdk-reference/pollar-core
 *
 * Variables de entorno requeridas:
 *   SPONSOR_SECRET_KEY — secret key de la cuenta sponsor (fee-bump de Stellar).
 *   POLAR_SECRET_KEY   — clave secreta de Pollar (sec_testnet_* / sec_mainnet_*).
 *   POLAR_EXTERNAL_USER_ID — id de usuario externo para Pollar.
 *   STELLAR_SECRET_KEY   — tu secret key de wallet Stellar existente (debe tener USDC).
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
import { StellarPaymentSubmitter } from '../infrastructure/stellar/StellarPaymentSubmitter';
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

async function addTrustline(
  server: Horizon.Server,
  secret: string,
  address: string,
  asset: Asset,
): Promise<void> {
  const keypair = Keypair.fromSecret(secret);
  const account = await server.loadAccount(address);

  const hasTrustline = account.balances.some(
    (b) =>
      (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
      b.asset_code === asset.getCode() &&
      b.asset_issuer === asset.getIssuer(),
  );

  if (hasTrustline) {
    console.log(`   ✅ Trustline ${asset.getCode()}:${asset.getIssuer()} ya existe.`);
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60)
    .build();

  tx.sign(keypair);
  await server.submitTransaction(tx);
  console.log(`   ✅ Trustline ${asset.getCode()}:${asset.getIssuer()} añadida.`);
}

async function main() {
  const sponsorSecretProvider = new EnvSecretProvider('SPONSOR_SECRET_KEY');
  const polarSecretProvider = new EnvSecretProvider('POLAR_SECRET_KEY');

  const existingSecret = process.env.STELLAR_SECRET_KEY;
  if (!existingSecret) {
    throw new Error('STELLAR_SECRET_KEY es requerida para off-ramp (necesitas USDC en tu wallet)');
  }

  const externalUserId = process.env.POLAR_EXTERNAL_USER_ID || 'rewallet-lab-stellar';
  const stellarSecretProvider = new EnvSecretProvider('STELLAR_SECRET_KEY');
  const polarProvider = new PollarRampProvider(
    polarSecretProvider,
    stellarSecretProvider,
    externalUserId,
  );

  const quoteUseCase = new CreateOnRampQuote(polarProvider);
  const orderUseCase = new ExecuteOnRampOrder(polarProvider);

  // 1. Usar wallet existente.
  console.log('🔹 Usando wallet Stellar existente…');
  const walletA = Keypair.fromSecret(existingSecret);
  console.log(`   Dirección: ${walletA.publicKey()}`);

  const server = new Horizon.Server(HORIZON_URL);
  const aAccount = await waitForAccount(server, walletA.publicKey());
  console.log(`   ✅ Wallet existe en Horizon (XLM: ${aAccount.balances.find(b => b.asset_type === 'native')?.balance ?? '0'}).`);

  const usdcBalance = aAccount.balances.find(
    (b) =>
      (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
      b.asset_code === 'USDC' &&
      b.asset_issuer === USDC_ISSUER,
  );
  console.log(`   ✅ Balance USDC: ${usdcBalance?.balance ?? '0'}`);
  if (!usdcBalance || Number(usdcBalance.balance) < 1) {
    throw new Error('Tu wallet no tiene suficiente USDC para hacer off-ramp. Fondea con USDC primero.');
  }

  // 2. Vincular wallet (no-custodial) al usuario en Pollar.
  console.log('\n🔹 Vinculando wallet con Pollar (wallet externa)…');
  await polarProvider.linkWallet('STELLAR', walletA.publicKey());
  console.log(`   ✅ Wallet ${walletA.publicKey()} vinculada como EXTERNAL.`);

  // 3. Consultar rutas de off-ramp disponibles en Pollar.
  console.log('\n🔹 Consultando rutas de off-ramp disponibles en Pollar…');
  const routesResp = await polarProvider.getRampRoutes('off');
  console.log(`   Rutas disponibles: ${routesResp.routes.length}`);
  for (const route of routesResp.routes) {
    console.log(`     - ${route.fiat.currency}/${route.asset.code} via ${route.fiat.rail} (${route.fiat.country})`);
    console.log(`       asset issuer: ${route.asset.identifier ?? 'N/A'}`);
  }

  if (routesResp.routes.length === 0) {
    throw new Error('No hay rutas de off-ramp disponibles en Pollar testnet');
  }

  // 4. Agregar trustlines de todos los activos de las rutas.
  console.log('\n🔹 Agregando trustlines de todos los activos de las rutas…');
  const addedAssets = new Set<string>();
  for (const route of routesResp.routes) {
    const issuer = route.asset.identifier;
    if (!issuer) {
      console.log(`     ⚠️  Saltando ${route.asset.code} sin issuer`);
      continue;
    }
    const key = `${route.asset.code}:${issuer}`;
    if (addedAssets.has(key)) {
      continue;
    }
    addedAssets.add(key);
    const asset = new Asset(route.asset.code, issuer);
    await addTrustline(server, walletA.secret(), walletA.publicKey(), asset);
  }

  // 5. Cotizar off-ramp usando la primera ruta disponible.
  console.log('\n🔹 Cotizando off-ramp usando la primera ruta disponible…');
  const firstRoute = routesResp.routes[0];
  const quote = await quoteUseCase.execute({
    direction: 'off',
    fiat: firstRoute.fiat,
    asset: { code: firstRoute.asset.code, identifier: firstRoute.asset.identifier ?? undefined, chain: 'STELLAR' },
    amount: { value: '5000', denomination: 'in' },
  });
  console.log(`   Cotización obtenida: ${quote.quotes[0]?.quoteId ?? 'N/A'}`);
  console.log(`   Rutas disponibles: ${quote.quotes.length}`);
  console.log(`   Monto a pagar: ${quote.quotes[0]?.amountIn ?? 'N/A'} ${firstRoute.asset.code}`);
  console.log(`   Monto a recibir: ${quote.quotes[0]?.amountOut ?? 'N/A'} ${firstRoute.fiat.currency}`);
  if (quote.rejected && quote.rejected.length > 0) {
    console.log(`   Rutas rechazadas: ${quote.rejected.length}`);
    for (const rej of quote.rejected) {
      console.log(`     - ${rej.routeId}: ${rej.reason}`);
    }
  }
  if (quote.quotes.length > 0) {
    const firstQuoteRoute = quote.quotes[0];
    const firstLeg = firstQuoteRoute.legs[0];
    console.log(`   ETA: ${firstQuoteRoute.etaSeconds ?? 'N/A'}s`);
    console.log(`   Expira: ${firstQuoteRoute.expiresAt ?? 'N/A'}`);
    console.log(`   Comisión proveedor: ${firstLeg.providerFees?.[0]?.amount ?? 'N/A'} ${firstLeg.providerFees?.[0]?.currency ?? ''}`);
    if (firstQuoteRoute.requiredFields && firstQuoteRoute.requiredFields.length > 0) {
      console.log(`   Campos requeridos por la ruta:`);
      for (const field of firstQuoteRoute.requiredFields) {
        console.log(`     - ${field.key} (${field.type}, requerido: ${field.required})`);
      }
    }
  }

  // 6. Crear orden de off-ramp con payee.
  console.log('\n🔹 Creando orden de off-ramp vía Pollar…');
  const payee: Record<string, any> = {
    stellarSource: walletA.publicKey(),
  };
  const quoteFirstRoute = quote.quotes[0];
  if (!quoteFirstRoute?.quoteId) {
    throw new Error('No se pudo obtener quoteId de la cotización');
  }
  if (quoteFirstRoute?.requiredFields) {
    for (const field of quoteFirstRoute.requiredFields) {
      if (!(field.key in payee)) {
        payee[field.key] = '';
      }
    }
  }

  const order = await orderUseCase.execute({
    quoteId: quoteFirstRoute.quoteId,
    payee,
  });
  console.log(`   Orden creada: ${order.id}`);
  console.log(`   Estado: ${order.state}`);
  console.log(`   Piernas: ${order.legs.length}`);
  if (order.pendingAction) {
    console.log(`   Acción pendiente: ${order.pendingAction.kind}`);
    console.log(`   Instrucciones: ${order.pendingAction.instructions ?? 'N/A'}`);
  }
  if (order.txHash) {
    console.log(`   Hash en cadena: ${order.txHash}`);
  }

  // 6. Firmar la pierna de rampa si hay una acción pendiente de tipo SIGNATURE.
  if (order.pendingAction?.kind === 'SIGNATURE') {
    console.log('\n🔹 Firmando pierna de rampa (SIGNATURE)…');
    try {
      const signedOrder = await polarProvider.signRampLeg(order.id, 0);
      console.log(`   ✅ Pierna firmada. Nueva estado: ${signedOrder.state}`);
      console.log(`   Nueva acción pendiente: ${signedOrder.pendingAction?.kind ?? 'NONE'}`);
      if (signedOrder.txHash) {
        console.log(`   Hash en cadena: ${signedOrder.txHash}`);
      }
    } catch (err: any) {
      console.log(`   ❌ Error firmando: ${err.message}`);
      console.log('   Continuando con polling...');
    }
  } else if (order.pendingAction?.kind === 'FIAT_PAYMENT') {
    console.log('\n💳 La orden requiere pago fiat del usuario (FIAT_PAYMENT).');
    console.log('   Instrucciones:', order.pendingAction.instructions ?? 'N/A');
  } else if (order.pendingAction?.kind === 'KYC') {
    console.log('\n🆔 La orden requiere verificación KYC.');
    console.log('   Instrucciones:', order.pendingAction.instructions ?? 'N/A');
  } else if (!order.pendingAction || order.pendingAction.kind === 'NONE') {
    console.log('\n✅ No hay acción pendiente. La orden puede continuar automáticamente.');
  }

  // 7. Poll del estado de la orden hasta que se resuelva.
  console.log('\n🔹 Esperando resolución de la orden (polling)…');
  let currentOrder = order;
  let attempts = 0;
  const maxAttempts = 20;

  while (
    currentOrder.state === 'created' ||
    currentOrder.state === 'awaiting_payment' ||
    currentOrder.state === 'processing' ||
    currentOrder.state === 'settling_onchain'
  ) {
    attempts++;
    if (attempts > maxAttempts) {
      console.log(`   ⏱️  Se alcanzó el máximo de intentos de polling (${maxAttempts}).`);
      break;
    }

    await new Promise((r) => setTimeout(r, 5000));
    currentOrder = await polarProvider.getOrderStatus(currentOrder.id);
    console.log(`   Intento ${attempts}: estado = ${currentOrder.state}`);
    if (currentOrder.pendingAction) {
      console.log(`   Acción pendiente: ${currentOrder.pendingAction.kind} — ${currentOrder.pendingAction.instructions ?? ''}`);
    }
    if (currentOrder.txHash) {
      console.log(`   Hash en cadena: ${currentOrder.txHash}`);
    }
  }

  console.log(`\n📋 Estado final de la orden: ${currentOrder.state}`);
  if (currentOrder.txHash) {
    console.log(`   Hash: https://stellar.expert/explorer/testnet/tx/${currentOrder.txHash}`);
  }

  if (currentOrder.state === 'completed') {
    console.log('\n✅ Off-ramp completado con éxito.');
  } else if (currentOrder.state === 'failed' || currentOrder.state === 'refunded') {
    console.log(`\n⚠️  Off-ramp terminó con estado: ${currentOrder.state}`);
  } else {
    console.log(`\n⏳ Off-ramp aún en proceso (estado: ${currentOrder.state}). Revisar manualmente.`);
  }
}

main().catch((err) => {
  console.error('❌ Demo falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
