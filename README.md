# ReWallet Stellar PoC 
# Pago Patrocinado (Fee-Bump) en Testnet

Prueba de concepto de onboarding y transferencia de USDC sin que el usuario final necesite XLM, utilizando arquitectura hexagonal, `@stellar/stellar-sdk` y `@sozu/faucet`. El mecanismo de gas sponsorship se implementa con `TransactionBuilder.buildFeeBumpTransaction`, donde un tercero (sponsor) paga la comisión de red.

---

## 🎯 Objetivo validado

Se demostró que una wallet A con **0 XLM** (fondada solo con USDC vía Sozu Faucet o Sponsored Reserves) puede enviar USDC a una wallet B, y la comisión de red es pagada por una **cuenta sponsor** mediante fee-bump, no por el usuario final.

---

## 🧩 Arquitectura Hexagonal

```
src/
├── domain/                 # Entidades de negocio (sin dependencias externas)
│   ├── Wallet.ts           # address, secret (en memoria)
│   └── Payment.ts          # from, to, amount, asset
├── application/            # Casos de uso y puertos
│   ├── ports/
│   │   ├── WalletProvider.ts    # Interfaz: createWallet(): Promise<Wallet>
│   │   └── PaymentSubmitter.ts  # Interfaz: submitWithSponsor(txXdr): Promise<string>
│   └── use-cases/
│       ├── CreateFundedWallet.ts
│       └── SendSponsoredPayment.ts
├── infrastructure/         # Adaptadores (infraestructura externa)
│   ├── sozu/
│   │   └── SozuWalletProvider.ts   # Ejecuta `npx @sozu/faucet claim` y parsea JSON
│   └── stellar/
│       ├── StellarPaymentSubmitter.ts # buildFeeBumpTransaction + submit a Horizon
│       └── StellarSponsoredWalletProvider.ts # Sponsored Reserves (CAP-33/CAP-31)
└── labstellar/             # Puntos de entrada E2E (scripts de validación en Testnet)
    ├── e2e-usdc-sozu-fee-bump.ts            # Pago USDC con Sozu Faucet + fee-bump
    ├── e2e-xlm-sponsored-reserves-fee-bump.ts  # Pago XLM con Sponsored Reserves + fee-bump
    └── e2e-usdc-sponsored-reserves-fee-bump.ts # Pago USDC con Sponsored Reserves + fee-bump
```

**Regla de oro respetada:** El dominio y los casos de uso no importan nada de `@stellar/stellar-sdk` ni de `child_process`. Solo dependen de las interfaces (puertos).

---

## 🛠 Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Lenguaje | TypeScript (Node.js) | — |
| SDK Stellar | `@stellar/stellar-sdk` | ^14.6.1 |
| Fondeo de wallets | `@sozu/faucet` (CLI) | ^0.2.0 |
| Red | Stellar Testnet | Horizon: `https://horizon-testnet.stellar.org` |
| Pruebas | Vitest | ^1.6.0 |
| Ejecución TS | ts-node | ^10.9.2 |
| Compilador | TypeScript | ^5.5.0 |

---

## 📦 Instalación

```bash
npm install
```

---

## 🔑 Variables de Entorno

Crear un archivo `.env` o exportar en la terminal antes de ejecutar:

```bash
export SPONSOR_SECRET_KEY="SA_TU_SECRET_KEY_DEL_SPONSOR"
export SOZU_FAUCET_URL="https://faucet.sozu.capital"  # opcional
```

- **`SPONSOR_SECRET_KEY`**: Clave secreta de una cuenta Stellar Testnet con XLM. Esta cuenta paga las comisiones de red (fee-bump). Nunca hardcodear en el repositorio.
- **`SOZU_FAUCET_URL`**: Origen del faucet Sozu (por defecto `https://faucet.sozu.capital`).

> ⚠️ Los secretos solo se manejan en memoria. Nunca se escriben en disco ni se versionan.

---

## ▶️ Ejecutar la Validación E2E

### Prueba 1: Pago USDC con Sozu Faucet + Fee-Bump

```bash
npm run e2e:usdc-fee-bump-sozu
```

Flujo:
1. Wallet A se crea vía Sozu Faucet (`npx @sozu/faucet claim`). Nace con USDC y 0 XLM para el usuario.
2. Wallet B se genera aleatoriamente, se fonda con Friendbot y se le añade la trustline de USDC.
3. Se construye y firma una transacción de pago USDC de A → B con la secret de A.
4. El XDR se envuelve en una fee-bump transaction con `buildFeeBumpTransaction`, se firma con el sponsor y se envía a Horizon.
5. Se imprime el hash de la transacción en consola.

---

### Prueba 2: Pago XLM con Sponsored Reserves + Fee-Bump (sin Friendbot)

```bash
npm run e2e:xlm-fee-bump-sponsored-reserves
```

Flujo:
1. Wallet A se crea vía Sponsored Reserves (CAP-33/CAP-31):
   - `beginSponsoringFutureReserves` + `createAccount` (sponsor paga 1 XLM de reserve).
   - `changeTrust(USDC)` + `endSponsoringFutureReserves` (sponsor paga 0.5 XLM de reserve).
   Todo envuelto en fee-bump pagada por el sponsor.
2. Sponsor envía 2 XLM a A para comisiones disponibles (A nace con 0 XLM gastables).
3. Wallet B se genera aleatoriamente, se fonda con Friendbot y se le añade la trustline de USDC.
4. Se construye y firma una transacción de pago XLM nativo de A → B con la secret de A.
5. El XDR se envuelve en una fee-bump transaction y se envía a Horizon.
6. Se imprime el hash de la transacción en consola.

---

### Prueba 3: Pago USDC con Sponsored Reserves + Fee-Bump (sin Friendbot)

```bash
npm run e2e:usdc-fee-bump-sponsored-reserves
```

> **⚠️ Requisito previo:** Wallet A debe tener saldo de USDC antes de ejecutar el pago.
> Usar Sozu Faucet para fundearla:
> ```bash
> npx @sozu/faucet claim <DIRECCION_DE_A>
> ```

Flujo:
1. Wallet A se crea vía Sponsored Reserves (CAP-33/CAP-31):
   - `beginSponsoringFutureReserves` + `createAccount` (sponsor paga 1 XLM de reserve).
   - `changeTrust(USDC)` + `endSponsoringFutureReserves` (sponsor paga 0.5 XLM de reserve).
   Todo envuelto en fee-bump pagada por el sponsor.
   - **A nace con 0 XLM gastables y 0 USDC balance.**
2. Sponsor envía 2 XLM a A para comisiones disponibles.
3. **Fondear A con USDC** — **Paso manual requerido:** usar Sozu Faucet (`npx @sozu/faucet claim <DIRECCION_DE_A>`) o recibir USDC de otra wallet.
4. Wallet B se genera aleatoriamente, se fonda con Friendbot y se le añade la trustline de USDC.
5. Se construye y firma una transacción de pago USDC de A → B con la secret de A.
6. El XDR se envuelve en una fee-bump transaction y se envía a Horizon.
7. Se imprime el hash de la transacción en consola.

> **Nota importante sobre USDC con Sponsored Reserves:** Wallet A nace con la **trustline USDC activa** pero **sin balance de USDC**. Para hacer un pago en USDC de A → B, primero debe **fundearse A con USDC** (vía faucet o pago directo), ya que el patrón de sponsorship solo cubre el reserve de la cuenta y el reserve de la trustline, no el saldo del activo.

---

## ✅ Transacciones Verificadas en Testnet (Red Real)

### Transacción 1: Fee-Bump con Sozu Faucet (pago USDC)

| Campo | Valor |
|-------|-------|
| **Hash** | `8028aabbd79ad15d003b3555a26534019a36772d7bc7d21aa74f194680d8aa7b` |
| **Estado** | ✅ `successful: true` |
| **Fee pagado por** (fee_account) | `GAWMZWOPC3ESC6YRRGYPWHPKMKRHIFRXBI27NQS6YKTF2JKZHRGUJXJI` (sponsor) |
| **Wallet emisora** (source_account) | `GAOYQYFSQDDVWAXZXD4UH7AVQ6G2T2CYHEJCOAI5KSZQU36IWLQL7NWF` (wallet A) |
| **Comisión cobrada** | 200 stroops |
| **Ledger** | 5620394 |
| **Fecha** | 2026-11-08T08:13:32Z |

### Transacción 2: Sponsored Reserves (pago XLM nativo)

| Campo | Valor |
|-------|-------|
| **Hash** | `48d42eecfc2797ecf209ae2ebe1300bb2233eb917436b4df1509aed0f4bb8055` |
| **Estado** | ✅ `successful: true` |
| **Fee pagada por** (fee_account) | `GBK6IQBLLQ6T7ZMHNVTZUVQ6ETISGVZUVWWAP5SJPPBUD66PM4RZFIRI` (sponsor) |
| **Wallet emisora** (source_account) | `GBLHMN6HUKTLL72BY7BHL4UYIE2UBV5O3MBWGHFGYD2ICSAAU4ONPFSZ` (wallet A) |
| **Comisión cobrada** | 200 stroops |
| **Ledger** | 5621655 |
| **Fecha** | 2026-11-08T09:58:37Z |

### Transacción 3: Sponsored Reserves + Pago USDC

| Campo | Valor |
|-------|-------|
| **Hash** | `db0ae64a00f266c433102c3d0d9d5d20874a0a5d15b59d45119d9c36417e2561` |
| **Estado** | ✅ `successful: true` |
| **Fee pagada por** (fee_account) | `GBK6IQBLLQ6T7ZMHNVTZUVQ6ETISGVZUVWWAP5SJPPBUD66PM4RZFIRI` (sponsor) |
| **Wallet emisora** (source_account) | `GA4QPRBYM2PQVECGLUXBGFQUZBQNHIJA4K4OIVKBXVVIETDQFQNDLYEI` (wallet A) |
| **Comisión cobrada** | 200 stroops |
| **Ledger** | 5621811 |
| **Fecha** | 2026-11-08T10:11:37Z |

### Transacción 4: Fee-Bump con Sozu Faucet (pago USDC) — Manejo de errores de red verificado

| Campo | Valor |
|-------|-------|
| **Hash** | `7c91e5cc544d36faeb34a13196b60eb6775575ca07ca89f204cac06fa38f53c0` |
| **Estado** | ✅ `successful: true` |
| **Fee pagada por** (fee_account) | `GBK6IQBLLQ6T7ZMHNVTZUVQ6ETISGVZUVWWAP5SJPPBUD66PM4RZFIRI` (sponsor) |
| **Wallet emisora** (source_account) | `GA3E3OYH3VSU2DABKHCXA6R3275BESVC7AR3W7DX4XAC7MGFWWPFRXCH` (wallet A) |
| **Comisión cobrada** | 200 stroops |
| **Ledger** | 5622025 |
| **Fecha** | 2026-11-08T10:29:27Z |

### Enlaces de verificación

- **Transacción 1 en Stellar Expert:** https://stellar.expert/explorer/testnet/tx/8028aabbd79ad15d003b3555a26534019a36772d7bc7d21aa74f194680d8aa7b
- **Transacción 2 en Stellar Expert:** https://stellar.expert/explorer/testnet/tx/48d42eecfc2797ecf209ae2ebe1300bb2233eb917436b4df1509aed0f4bb8055
- **Transacción 3 en Stellar Expert:** https://stellar.expert/explorer/testnet/tx/db0ae64a00f266c433102c3d0d9d5d20874a0a5d15b59d45119d9c36417e2561
- **Transacción 4 en Stellar Expert:** https://stellar.expert/explorer/testnet/tx/7c91e5cc544d36faeb34a13196b60eb6775575ca07ca89f204cac06fa38f53c0

### Evidencia en cadena (respuesta de Horizon)

**Transacción 4 (Fee-Bump + Sozu Faucet, después de recuperación de red):**

```json
{
  "successful": true,
  "hash": "7c91e5cc544d36faeb34a13196b60eb6775575ca07ca89f204cac06fa38f53c0",
  "source_account": "GA3E3OYH3VSU2DABKHCXA6R3275BESVC7AR3W7DX4XAC7MGFWWPFRXCH",
  "fee_account": "GBK6IQBLLQ6T7ZMHNVTZUVQ6ETISGVZUVWWAP5SJPPBUD66PM4RZFIRI",
  "fee_charged": "200",
  "max_fee": "200",
  "fee_bump_transaction": true,
  "inner_transaction": {
    "hash": "ee92ae1f9e99ec82ae583320a8ef92a3a4791f00a83943f2540401fea10becb8",
    "max_fee": "100"
  }
}
```

---

## 🛡️ Manejo de Errores en SozuWalletProvider

El adaptador `SozuWalletProvider` implementa reintentos con backoff exponencial para errores recuperables del faucet Sozu:

### Errores recuperables (reintenta automáticamente)

| Origen | Errores | Comportamiento |
|--------|---------|----------------|
| Red (Node.js) | `ECONNREFUSED`, `ECONNRESET`, `ENETUNREACH`, `ECONNABORTED`, `ETIMEDOUT`, `EAI_AGAIN` | Reintenta con backoff exponencial |
| HTTP | `429 Too Many Requests` | Reintenta con backoff exponencial |
| JSON del faucet | `user_cooldown`, `global_cooldown`, `rate_limited` | Reintenta esperando `nextAvailableAt` o delay por defecto |

### Configuración (`SozuWalletProviderOptions`)

| Opción | Por defecto | Descripción |
|--------|-------------|-------------|
| `maxRetries` | `3` | Número máximo de reintentos |
| `baseDelayMs` | `5000` | Retraso base en ms para backoff exponencial |

### Backoff exponencial

- Intento 1: inmediatamente
- Intento 2: 5 segundos
- Intento 3: 10 segundos
- Intento 4: 20 segundos
- Tope máximo: 60 segundos

Si después de agotar los reintentos el error persiste, se lanza el último error capturado.

---

## 🧪 Ejecutar Tests

### Tests unitarios (sin red, siempre verdes)

```bash
npm test
```

### Tests de integración (red real Testnet)

Requiere `E2E=true` y `SPONSOR_SECRET_KEY`:

```bash
E2E=true npm run test:integration
```

Estos tests se saltan automáticamente si no se definen las variables de entorno.

---

## 📜 Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm run e2e:usdc-fee-bump-sozu` | Ejecuta el flujo E2E con Sozu Faucet + fee-bump (pago USDC) contra Testnet y muestra el hash |
| `npm run e2e:xlm-fee-bump-sponsored-reserves` | Ejecuta el flujo Sponsored Reserves + fee-bump (pago XLM nativo) contra Testnet y muestra el hash |
| `npm run e2e:usdc-fee-bump-sponsored-reserves` | Ejecuta el flujo Sponsored Reserves + fee-bump (pago USDC) contra Testnet (requiere fondear A con USDC primero) |
| `npm test` | Ejecuta tests unitarios (sin red) |
| `npm run test:integration` | Ejecuta tests de integración contra Testnet (requiere `E2E=true`) |
| `npm run lint` | Verifica tipos con `tsc --noEmit` |
| `npm run build` | Compila TypeScript a `dist/` |

---

## 📌 Criterios de Aceptación Cumplidos

- [x] `tsc --noEmit` compila sin errores
- [x] `npm test` pasa sin errores (tests unitarios, integración skippeada sin red)
- [x] `npm run e2e:usdc-fee-bump-sozu` finaliza con hash de transacción exitoso (verificado en Testnet)
- [x] `npm run e2e:xlm-fee-bump-sponsored-reserves` finaliza con hash de transacción exitoso (verificado en Testnet)
- [x] `npm run e2e:usdc-fee-bump-sponsored-reserves` compila y está listo para ejecutar (requiere fondear A con USDC)
- [x] Las transacciones aparecen como exitosas en Stellar Expert Testnet
- [x] La comisión fue pagada por la cuenta del sponsor, no por la wallet A (fee-bump)
- [x] La wallet A tuvo 0 XLM para el usuario final (fondada solo con USDC o Sponsored Reserves)
- [x] Arquitectura hexagonal: dominio y casos de uso sin dependencias de SDK ni child_process
- [x] Secretos solo en memoria, ninguno hardcodeado
- [x] Manejo de errores de red con reintentos y backoff exponencial en `SozuWalletProvider`

---

## 🚀 Próximos Pasos (Desarrollo Progresivo)

Esta PoC valida el mecanismo principal de **fee-bump** y **sponsored reserves**. Para llevar a producción o extender:

1. **Persistencia de secretos**: Almacenar secretos de forma segura (vault, variables de entorno cifradas) en lugar de solo en memoria.
2. **Más assets**: Soportar otros tokens además de USDC (Circle SAC).
3. **Frontend**: Conectar esta lógica a una interfaz de usuario para el onboarding.
4. **Sponsored reserves en producción**: Implementar patrocinio de trustlines y cuentas manualmente para Mainnet (donde no existe Friendbot).

---

## 📄 Licencia

MIT
