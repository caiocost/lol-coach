# Dispositivos compatíveis com as luzes

Gerado de [openrgb.org/devices_1.0](https://openrgb.org/devices_1.0.html) (OpenRGB 1.0, a versão que vem no pacote) por `scripts/gerar-dispositivos.mjs`.

A lista é por **família de controlador** (o chip que o OpenRGB conversa), não por produto. Se o seu teclado não aparece pelo nome, procure pela marca: vários modelos usam o mesmo controlador. O jeito mais rápido de saber é abrir o coach: o menu **Luzes** da bandeja mostra o que foi detectado.

- ✅ **anima no coach**: o OpenRGB controla LED por LED (modo Direct).
- ⚠️ **problemático**: o OpenRGB suporta com ressalvas; veja a página do dispositivo no site deles.
- 🔒 **precisa de PawnIO + admin**: conexão SMBus/I2C. Instale o [PawnIO](https://pawnio.eu) e rode o OpenRGB como administrador. Sem isso, só os dispositivos USB acendem.
- Famílias sem o modo Direct ficam de fora: o OpenRGB reconhece, mas o coach não consegue animar.

Testado de verdade: **HyperX Alloy Origins** (teclado), **Kingston Fury DDR5** (RAM), **ASUS TUF GAMING X670E-PLUS** (placa).

## Teclados (61)

Obrigatório para os letreiros (nome do campeão, KILL, pixel art). Precisa ser RGB **por tecla**.

| Controlador | Conexão | Coach | Precisa |
|---|---|---|---|
| A4Tech Bloody B820R | USB | ✅ |  |
| Alienware AW410 Keyboard | USB | ✅ |  |
| Alienware AW510 Keyboard | USB | ✅ |  |
| Anne Pro 2 | USB | ✅ |  |
| AOC Keyboard | USB | ✅ |  |
| Asus AURA Core | USB | ⚠️ |  |
| Asus Aura Keyboard | USB | ✅ |  |
| Asus Aura TUF Keyboard | USB | ✅ |  |
| Cherry Keyboard | USB | ⚠️ |  |
| CLEVO Keyboard | USB | ✅ |  |
| Coolermaster Masterkeys Keyboards | USB | ✅ |  |
| Corsair K55 RGB Pro XT | USB | ✅ |  |
| Corsair K65 Mini | USB | ✅ |  |
| Corsair Peripheral | USB | ✅ |  |
| Corsair Peripherals V2 Hardware | USB | ✅ |  |
| Corsair Peripherals V2 Software | USB | ✅ |  |
| Cougar 700K Evo Keyboard | USB | ✅ |  |
| Dark Project Keyboard | USB | ✅ |  |
| Das Keyboard | USB | ✅ |  |
| Ducky Keyboard | USB | ✅ |  |
| EVGA USB Keyboard | USB | ✅ |  |
| EVision V2 Keyboard | USB | ✅ |  |
| Fnatic Streak | USB | ✅ |  |
| Genesis Thor 300 | USB | ⚠️ |  |
| HyperX Alloy Elite | USB | ✅ |  |
| HyperX Alloy Elite 2 | USB | ✅ |  |
| HyperX Alloy FPS | USB | ✅ |  |
| HyperX Alloy Origins | USB | ✅ |  |
| HyperX Alloy Origins 60 and 65 | USB | ✅ |  |
| HyperX Alloy Origins Core | USB | ✅ |  |
| HyperX Eve 1800 | USB | ✅ |  |
| HyperX Origins 2 65 | USB | ✅ |  |
| Ionico-II 17 | USB | ✅ |  |
| Lenovo 4 Zone USB | USB | ✅ |  |
| Lenovo USB | USB | ✅ |  |
| Logitech G213 | USB | ✅ |  |
| Logitech G815 | USB | ✅ |  |
| Logitech G915 | USB | ✅ |  |
| Logitech HID++ 2.0 | USB | ✅ |  |
| Logitech Lightspeed | USB | ✅ |  |
| Mountain Keyboard | USB | ✅ |  |
| MSI 3 Zone Keyboard | USB | ✅ |  |
| MSI Laptop SteelSeries RGB | USB | ✅ |  |
| MSI MS-1565 Mystic Light Keyboard (64 Byte) | USB | ✅ |  |
| QMK Keychron | USB | ✅ |  |
| Quantum Mechanical Keyboard (QMK) | USB | ✅ |  |
| Razer | USB | ✅ |  |
| Roccat Horde Aimo | USB | ✅ |  |
| Roccat Vulcan Keyboard | USB | ✅ |  |
| SayoDevice E1 | USB | ✅ |  |
| Sinowealth Keyboard | USB | ✅ |  |
| Skyloong GK104 Pro | USB | ✅ |  |
| Skyloong GK68HE Pro | USB | ✅ |  |
| Steel Series APEX | USB | ✅ |  |
| Steel Series Apex (Old) | USB | ✅ |  |
| Steel Series Apex Tri Zone Keyboards | USB | ✅ |  |
| Thermaltake PoseidonZ | USB | ✅ |  |
| Valkyrie | USB | ✅ |  |
| Witmod Keyboard | USB | ✅ |  |
| Wooting Keyboards | USB | ✅ |  |
| XPG Summoner Keyboard | USB | ✅ |  |

## Memória RAM (8)

Extra: ondas e flashes acompanham o teclado.

| Controlador | Conexão | Coach | Precisa |
|---|---|---|---|
| Corsair DRAM | SMBus | ✅ | 🔒 |
| Crucial RAM | SMBus | ✅ | 🔒 |
| ENE SMBus Device | SMBus | ✅ | 🔒 |
| HyperX DRAM | I2C | ✅ | 🔒 |
| Kingston Fury DDR4/5 DRAM | SMBus | ✅ | 🔒 |
| Patriot Viper | I2C | ✅ | 🔒 |
| Patriot Viper Steel | I2C | ✅ | 🔒 |
| T-Force Xtreem | SMBus | ✅ | 🔒 |

## Placas-mãe (12)

Extra: pulsa junto com os efeitos.

| Controlador | Conexão | Coach | Precisa |
|---|---|---|---|
| Asus Aura USB | USB | ✅ |  |
| Asus Aura USB Mainboard | USB | ✅ |  |
| ENE SMBus Device | SMBus | ✅ | 🔒 |
| Gigabyte Fusion SMBus | I2C | ✅ | 🔒 |
| Gigabyte Fusion2 SMBus | I2C | ✅ | 🔒 |
| Gigabyte RGB Fusion 2 USB | USB | ✅ |  |
| HP Omen 30L | USB | ✅ |  |
| JGINYUEInternalUSB | USB | ✅ |  |
| JGINYUEInternalUSBV2 | USB | ✅ |  |
| MSI Mystic Light (112 Byte) | USB | ✅ |  |
| MSI Mystic Light (162 Byte) | USB | ✅ |  |
| MSI Mystic Light (185 Byte) | USB | ✅ |  |
