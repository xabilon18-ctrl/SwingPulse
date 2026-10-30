"""Display name -> TradingView symbol, for every instrument with an explicit one.

Moved out of webapp/server.py (2026-10-19) so the DATA layer can read it
without importing Flask: for crypto the TradingView symbol is also where
prices come from (exchange_feed.py — the same Binance / Coinbase pair the
user's charts show). server.build_tv_map still adds the rule-based symbols
(XETR:, LSE:, FX:, NASDAQ: ...) for everything not listed here.
"""

# ---------------------------------------------------------------------------
# Display-name → TradingView symbol mapping
# Matched to the user's exact TradingView watchlist & exchanges
# ---------------------------------------------------------------------------

# Direct overrides: display_name → EXCHANGE:SYMBOL
TV_BY_NAME: dict[str, str] = {
    # ── Currency — exotic pairs. NB 'FX:'/'FX_IDC:' are TRADINGVIEW's own
    #    exchange prefixes, not our category name — FX_IDC carries the non-G8
    #    crosses that FX: does not. Do not rename these to match the app's
    #    Currency vocabulary; they are someone else's identifiers.
    # USD base
    'USDPLN':   'FX_IDC:USDPLN',
    'USDZAR':   'FX_IDC:USDZAR',
    'USDMXN':   'FX_IDC:USDMXN',
    'USDSEK':   'FX_IDC:USDSEK',
    'USDNOK':   'FX_IDC:USDNOK',
    'USDSGD':   'FX_IDC:USDSGD',
    'USDTRY':   'FX_IDC:USDTRY',
    'USDHKD':   'FX_IDC:USDHKD',
    'USDCNH':   'FX_IDC:USDCNH',
    'USDCZK':   'FX_IDC:USDCZK',
    'USDHUF':   'FX_IDC:USDHUF',
    # EUR base
    'EURSEK':   'FX_IDC:EURSEK',
    'EURZAR':   'FX_IDC:EURZAR',
    'EURMXN':   'FX_IDC:EURMXN',
    'EURNOK':   'FX_IDC:EURNOK',
    'EURSGD':   'FX_IDC:EURSGD',
    'EURTRY':   'FX_IDC:EURTRY',
    'EURHUF':   'FX_IDC:EURHUF',
    'EURPLN':   'FX_IDC:EURPLN',
    # GBP base
    'GBPSGD':   'FX_IDC:GBPSGD',
    'GBPZAR':   'FX_IDC:GBPZAR',
    'GBPMXN':   'FX_IDC:GBPMXN',
    'GBPSEK':   'FX_IDC:GBPSEK',
    # AUD/NZD base
    'AUDSGD':   'FX_IDC:AUDSGD',
    'NZDSGD':   'FX_IDC:NZDSGD',
    # SGD/ZAR/TRY/MXN base
    'SGDJPY':   'FX_IDC:SGDJPY',
    'ZARJPY':   'FX_IDC:ZARJPY',
    'TRYJPY':   'FX_IDC:TRYJPY',
    'MXNJPY':   'FX_IDC:MXNJPY',
    # (The old 'USDAUD' → FX:AUDUSD reversal override died with the 2026-08-25
    # forex restore: the pair now ships as AUDUSD, matching XM and Yahoo, so
    # the generic *=X → FX:name rule already lands on FX:AUDUSD.)

    # ── Commodities (TVC) ──
    'GOLD':     'TVC:GOLD',
    'SILVER':   'TVC:SILVER',
    'USOIL':    'TVC:USOIL',
    'WTI':      'TVC:USOIL',

    # ── Indices (matched to user's brokers) ──
    'US100':    'CAPITALCOM:NAS100',
    'US500':    'CAPITALCOM:SPX500',
    'SW20':     'CAPITALCOM:SW20',
    'UK100':    'CFI:UK100',
    'IT40':     'FOREXCOM:IT40',
    'US30':     'CAPITALCOM:US30',
    'USD_IDX':  'TVC:DXY',   # currency_index.py: equal-weight, NOT the same basket — direction check only
    'EUR_IDX':  'TVC:EXY',   # currency_index.py: equal-weight, NOT the same basket — direction check only
    'GBP_IDX':  'TVC:BXY',   # currency_index.py: equal-weight, NOT the same basket — direction check only
    'JPY_IDX':  'TVC:JXY',   # currency_index.py: equal-weight, NOT the same basket — direction check only
    'CHF_IDX':  'TVC:SXY',   # currency_index.py: equal-weight, NOT the same basket — direction check only
    'CAD_IDX':  'TVC:CXY',   # currency_index.py: equal-weight, NOT the same basket — direction check only
    'AUD_IDX':  'TVC:AXY',   # currency_index.py: equal-weight, NOT the same basket — direction check only
    'NZD_IDX':  'TVC:ZXY',   # currency_index.py: equal-weight, NOT the same basket — direction check only
    # Other currencies (2026-10-30): TradingView publishes no index for them; the
    # link opens the dollar pair, which moves the OPPOSITE way to the index.
    'ZAR_IDX':  'FX_IDC:USDZAR',
    'MXN_IDX':  'FX_IDC:USDMXN',
    'SGD_IDX':  'FX_IDC:USDSGD',
    'SEK_IDX':  'FX_IDC:USDSEK',
    'NOK_IDX':  'FX_IDC:USDNOK',
    'TRY_IDX':  'FX_IDC:USDTRY',
    'PLN_IDX':  'FX_IDC:USDPLN',
    'HUF_IDX':  'FX_IDC:USDHUF',
    'CZK_IDX':  'FX_IDC:USDCZK',
    'CNY_IDX':  'FX_IDC:USDCNH',
    'FRA40':    'FX:FRA40',
    'NETH25':   'ICMARKETS:NETH25',
    'RUSSELL':  'CAPITALCOM:RTY',
    'DAX':      'IG:DAX',
    'CHINA50':  'FOREXCOM:CHINA50',   # the user's FOREX.com A50 CFD (2026-09-24)
    'CHINAH':   'HSI:HSCEI',
    'HANGSENG': 'IG:HANGSENG',
    'NQTW':     'NASDAQ:NQTW',
    'EU50EUR':  'OANDA:EU50EUR',
    'SG30SGD':  'OANDA:SG30SGD',
    'SPAIN35':  'THINKMARKETS:SPAIN35',
    'NI225':    'TVC:NI225',

    # ── Crypto USD pairs (COINBASE) ──
    'BTCUSD':   'COINBASE:BTCUSD',
    'ETHUSD':   'COINBASE:ETHUSD',
    'LINKUSD':  'COINBASE:LINKUSD',

    # ── Crypto USDT pairs (BINANCE) ──
    'XRPUSDT':   'BINANCE:XRPUSDT',
    'BNBUSDT':   'BINANCE:BNBUSDT',
    'ADAUSDT':   'BINANCE:ADAUSDT',
    'DOGEUSDT':  'BINANCE:DOGEUSDT',
    'DOTUSDT':   'BINANCE:DOTUSDT',
    'AVAXUSDT':  'BINANCE:AVAXUSDT',
    'SHIBUSDT':  'BINANCE:SHIBUSDT',
    'ATOMUSDT':  'BINANCE:ATOMUSDT',
    'ALGOUSDT':  'BINANCE:ALGOUSDT',
    'APEUSDT':   'BINANCE:APEUSDT',
    'APTUSDT':   'BINANCE:APTUSDT',
    'CHZUSDT':   'BINANCE:CHZUSDT',
    'DYDXUSDT':  'BINANCE:DYDXUSDT',
    'ICPUSDT':   'BINANCE:ICPUSDT',
    'NEOUSDT':   'BINANCE:NEOUSDT',
    'SOLUSDT':   'BINANCE:SOLUSDT',
    'AAVEUSDT':  'BINANCE:AAVEUSDT',
    'MASKUSDT':  'BINANCE:MASKUSDT',
    'OPUSDT':    'BINANCE:OPUSDT',
    'TWTUSDT':   'BINANCE:TWTUSDT',
    'UNIUSDT':   'BINANCE:UNIUSDT',

    # ── NYSE stocks ──
    'BA':   'NYSE:BA',
    'CVX':  'NYSE:CVX',
    'IBM':  'NYSE:IBM',
    'JPM':  'NYSE:JPM',
    'AXP':  'NYSE:AXP',
    'CRM':  'NYSE:CRM',
    'GS':   'NYSE:GS',
    'KO':   'NYSE:KO',
    'PG':   'NYSE:PG',
    'HD':   'NYSE:HD',
    'V':    'NYSE:V',
    'DOW':  'NYSE:DOW',
    'TRV':  'NYSE:TRV',
    'DIS':  'NYSE:DIS',
    'CAT':  'NYSE:CAT',
    'NKE':  'NYSE:NKE',
    'JNJ':  'NYSE:JNJ',
    'VZ':   'NYSE:VZ',
    'MCD':  'NYSE:MCD',
    'MRK':  'NYSE:MRK',
    'MMM':  'NYSE:MMM',
    'UNH':  'NYSE:UNH',
    'WMT':  'NASDAQ:WMT',
    'BUD':  'NYSE:BUD',
    'APOLLO': 'NYSE:APO',

    # ── Other US exchanges ──
    'ORCL':  'NYSE:ORCL',
    'TSM':   'NYSE:TSM',
    'UBER':  'NYSE:UBER',
    'ANET':  'NYSE:ANET',
    'DELL':  'NYSE:DELL',
    'NET':   'NYSE:NET',
    'NOW':   'NYSE:NOW',
    'SNOW':  'NYSE:SNOW',
    'WOLF':  'NYSE:WOLF',
    'STM':   'NYSE:STM',

    # ── German stocks with _DE display-name suffix ──
    'SAP_DE':  'XETR:SAP',
    'DTE_DE':  'XETR:DTE',
    'MRK_DE':  'XETR:MRK',
    'LEG_DE':  'XETR:LEG',

    # ── New US500 NYSE stocks ──
    'BAC':   'NYSE:BAC',
    'WFC':   'NYSE:WFC',
    'C':     'NYSE:C',
    'BRKB':  'NYSE:BRK.B',
    'GE':    'NYSE:GE',
    'UPS':   'NYSE:UPS',
    'UNP':   'NYSE:UNP',
    'NEE':   'NYSE:NEE',
    'SO':    'NYSE:SO',
    'DUK':   'NYSE:DUK',
    'CEG':   'NASDAQ:CEG',
    'PCG':   'NYSE:PCG',
    # Ferguson moved its primary listing to the NYSE; the LSE line (FERG.L)
    # went dead 2026-07-17 and Yahoo serves it a single bar. Without this
    # override the generic rule-4 fall-through would send it to NASDAQ.
    'FERG':  'NYSE:FERG',
    # Flutter did the same, on 2026-07-31. Its display name moves to FLUT
    # too: on Yahoo and TradingView the bare FLTR is now the VanEck IG
    # Floating Rate ETF, so the old name would point a gambling row at a
    # bond fund.
    'FLUT':  'NYSE:FLUT',

    # ── Spanish stocks (BME) ──
    'SAN':   'BME:SAN',
    'BBVA':  'BME:BBVA',
    'SAB':   'BME:SAB',
    'BKT':   'BME:BKT',
    'CABK':  'BME:CABK',
    'MAP':   'BME:MAP',
    'IBE':   'BME:IBE',
    'ELE':   'BME:ELE',
    'NTGY':  'BME:NTGY',
    'ITX':   'BME:ITX',
    'AMS':   'BME:AMS',
    'IDR':   'BME:IDR',
    'FER':   'BME:FER',
    'ACS':   'BME:ACS',
    'SCYR':  'BME:SCYR',
    'TEF':   'BME:TEF',
    'REP':   'BME:REP',
    'GRF':   'BME:GRF',
    'IAG':   'BME:IAG',

    # ── Canadian stocks (TSX) ──
    'CAN60': 'TSX:XIU',
    'RY':    'TSX:RY',
    'TD':    'TSX:TD',
    'BNS':   'TSX:BNS',
    'BMO':   'TSX:BMO',
    'CM':    'TSX:CM',
    'MFC':   'TSX:MFC',
    'ENB':   'TSX:ENB',
    'TRP':   'TSX:TRP',
    'CNQ':   'TSX:CNQ',
    'SU':    'TSX:SU',
    'CVE':   'TSX:CVE',
    'ABX':   'TSX:ABX',
    'AEM':   'TSX:AEM',
    'WPM':   'TSX:WPM',
    'NTR':   'TSX:NTR',
    'SHOP':  'TSX:SHOP',
    'CSU':   'TSX:CSU',
    'CNR':   'TSX:CNR',
    'CP':    'TSX:CP',
    'ATD':   'TSX:ATD',
    'QSR':   'TSX:QSR',
    'BCE':   'TSX:BCE',
    'TELUS': 'TSX:T',

    # ── New Commodities ──
    'BRENT':     'TVC:UKOIL',
    'NGAS':      'TRADENATION:NATURALGAS',
    'PLATINUM':  'TVC:PLATINUM',
    'PALLADIUM': 'TVC:PALLADIUM',
    'COPPER':    'TRADENATION:COPPER',
    'CORN':      'CBOT:ZC1!',
    'WHEAT':     'CBOT:ZW1!',
    'SUGAR':     'ICEUS:SB1!',
    'COFFEE':    'ICEUS:KC1!',
    'COCOA':     'ICEUS:CC1!',
    'SOYBEANS':  'CBOT:ZS1!',
    'COTTON':    'ICEUS:CT1!',

    # ── New Indices ──
    'AUS200':    'ASX:XJO',
    'SA40':      'TRADENATION:SA40',
    'USDX':      'TVC:DXY',

    # ── New Crypto (BINANCE) ──
    'ADAUSDT':   'BINANCE:ADAUSDT',
    'LTCUSDT':   'BINANCE:LTCUSDT',
    'BCHUSDT':   'BINANCE:BCHUSDT',
    'XLMUSDT':   'BINANCE:XLMUSDT',
    'ETCUSDT':   'BINANCE:ETCUSDT',
    'TRXUSDT':   'BINANCE:TRXUSDT',
    'NEARUSDT':  'BINANCE:NEARUSDT',
    'MATICUSDT': 'BINANCE:POLUSDT',   # Polygon migrated MATIC → POL
    'FILUSDT':   'BINANCE:FILUSDT',
    'THETAUSDT': 'BINANCE:THETAUSDT',
    'SANDUSDT':  'BINANCE:SANDUSDT',
    'MANAUSDT':  'BINANCE:MANAUSDT',
    'ARBUSDT':   'BINANCE:ARBUSDT',
    'LDOUSDT':   'BINANCE:LDOUSDT',
    'GRTUSDT':   'BINANCE:GRTUSDT',
    'FTMUSDT':   'BINANCE:SUSDT',     # Fantom migrated FTM → Sonic (S)
    'CRVUSDT':   'BINANCE:CRVUSDT',
    'IMXUSDT':   'BINANCE:IMXUSDT',
    'ENJUSDT':   'BINANCE:ENJUSDT',

    # ── New Commodities ──
    'GASOLINE':  'NYMEX:RB1!',
    'HEATINGOIL': 'NYMEX:HO1!',
    'OATMEAL':   'CBOT:ZO1!',

    # ── New Crypto (BINANCE) ──
    'ZECUSDT':   'BINANCE:ZECUSDT',
    'DASHUSDT':  'BINANCE:DASHUSDT',
    'EOSUSDT':   'BINANCE:EOSUSDT',
    'EGLDUSDT':  'BINANCE:EGLDUSDT',
    'HBARUSDT':  'BINANCE:HBARUSDT',
    'FLOWUSDT':  'BINANCE:FLOWUSDT',
    'STXUSDT':   'BINANCE:STXUSDT',
    'VETUSDT':   'BINANCE:VETUSDT',
    'KAVAUSDT':  'BINANCE:KAVAUSDT',
    'ROSEUSDT':  'BINANCE:ROSEUSDT',
    'CFXUSDT':   'BINANCE:CFXUSDT',
    'GALAUSDT':  'BINANCE:GALAUSDT',
    'HOTUSDT':   'BINANCE:HOTUSDT',
    'ONEUSDT':   'BINANCE:ONEUSDT',
    'ZILUSDT':   'BINANCE:ZILUSDT',
    'IOTAUSDT':  'BINANCE:IOTAUSDT',
    'XTZUSDT':   'BINANCE:XTZUSDT',

    # ── UK stocks — special name overrides ──
    'BT_A':      'LSE:BT.A',
    'BAE':       'LSE:BA.',
    'RR_UK':     'LSE:RR.',
    'NG_UK':     'LSE:NG.',
    'RELX':      'LSE:REL',
    'JD_UK':     'LSE:JD.',

    # ── French stocks — special name overrides ──
    'SANOFI':    'EURONEXT:SAN',
    'AC_FR':     'EURONEXT:AC',
    'SW_FR':     'EURONEXT:SW',

    # ── Italian stocks — special name overrides ──
    'IG_IT':     'MIL:IG',
    'REC_IT':    'MIL:REC',
    'TRN_IT':    'MIL:TRN',
    'UNI_IT':    'MIL:UNI',
    'CPR_IT':    'MIL:CPR',

    # ── Dutch (AEX) stocks — special name overrides ──
    'NN_NL':     'EURONEXT:NN',
    'AD_NL':     'EURONEXT:AD',
    'AGN_NL':    'EURONEXT:AGN',
    'MT_NL':     'EURONEXT:MT',

    # ── Swiss (SIX) stocks — special name overrides ──
    'ROG_SW':    'SIX:ROG',   # retired 2026-07-28 — ROG.SW returns no Yahoo data;
                              # the instrument is now 'ROCHE' on the RHHBY ADR (see below)

    # ── Australian (ASX) stocks — special name overrides ──
    'TCL_AX':    'ASX:TCL',
    'ALL_AX':    'ASX:ALL',

    # ── South African (JSE) stocks — special name overrides ──
    'SOL_ZA':    'JSE:SOL',
    'DSY_ZA':    'JSE:DSY',

    # ── Broken-symbol fixes (verified against TradingView symbol-search 2026-06-28) ──
    # Stockholm: TV uses OMXSTO:{ROOT}_{CLASS}, not STO:{name}
    'ATCOA':     'OMXSTO:ATCO_A',
    'ERICB':     'OMXSTO:ERIC_B',
    'HMB':       'OMXSTO:HM_B',
    'SEBA':      'OMXSTO:SEB_A',
    'SWEDA':     'OMXSTO:SWED_A',
    'VOLVB':     'OMXSTO:VOLV_B',
    # Copenhagen: TV uses OMXCOP:{name} (B-shares as {ROOT}_B)
    'DSV':       'OMXCOP:DSV',
    'MAERSKB':   'OMXCOP:MAERSK_B',
    'NOVOB':     'OMXCOP:NOVO_B',
    # London: TV requires trailing '.' on the LSE ticker
    'AV':        'LSE:AV.',
    'BP':        'LSE:BP.',
    'SN':        'LSE:SN.',
    'TW':        'LSE:TW.',
    'UU':        'LSE:UU.',
    # Exchange / ticker corrections.
    # NOTE (2026-07-28): these entries were added when the chart LINKS broke,
    # but the Yahoo data tickers in Instruments.txt were never updated to match
    # — so all of these silently fetched nothing and dropped out of the payload
    # for months. The instrument file now carries the working symbols, and the
    # keys here follow the display names it uses. Whenever a link override is
    # added because an instrument re-tickered, check the DATA ticker too.
    'CRH':       'NYSE:CRH',          # data CRH   — moved primary listing LSE → NYSE
    'CCL':       'NYSE:CCL',          # data CCL   — Carnival plc left the LSE
    'CNH':       'NYSE:CNH',          # data CNH   — CNH Industrial (was CNHI/IT40)
    'AXA':       'EURONEXT:CS',       # data CS.PA — AXA's Euronext code is CS, not AXA
    'BPER':      'MIL:BPE',           # data BPE.MI
    'HERA':      'MIL:HER',           # data HER.MI
    'INWIT':     'MIL:INW',           # data INW.MI
    'WDS':       'ASX:WDS',           # data WDS.AX — Woodside (was WPL)
    'BHG':       'JSE:BHG',           # data BHG.JO — BHP Group (was BIL)
    'BTRW':      'LSE:BTRW',          # data BTRW.L — Barratt Redrow (was BDEV)
    'ROCHE':     'OTC:RHHBY',         # data RHHBY — the US ADR, so the chart matches
                                      # the card. The Swiss line (SIX:ROG) is dead on
                                      # Yahoo; note the ADR prices in USD, not CHF.

    # ── Indices (additional) ──
    'SOX':   'NASDAQ:SOX',

    # ── NASDAQ-listed stocks ──
    'AAPL':  'NASDAQ:AAPL',
    'ADBE':  'NASDAQ:ADBE',
    'ADI':   'NASDAQ:ADI',
    'ADP':   'NASDAQ:ADP',
    'ADSK':  'NASDAQ:ADSK',
    'AEP':   'NASDAQ:AEP',
    'ALGN':  'NASDAQ:ALGN',
    'AMAT':  'NASDAQ:AMAT',
    'AMD':   'NASDAQ:AMD',
    'AMGN':  'NASDAQ:AMGN',
    'AMZN':  'NASDAQ:AMZN',
    'ARM':   'NASDAQ:ARM',
    'ASML':  'NASDAQ:ASML',
    'AVGO':  'NASDAQ:AVGO',
    'BIDU':  'NASDAQ:BIDU',
    'BIIB':  'NASDAQ:BIIB',
    'BKNG':  'NASDAQ:BKNG',
    'CDNS':  'NASDAQ:CDNS',
    'CHKP':  'NASDAQ:CHKP',
    'CHTR':  'NASDAQ:CHTR',
    'CMCSA': 'NASDAQ:CMCSA',
    'COST':  'NASDAQ:COST',
    'CPRT':  'NASDAQ:CPRT',
    'CRWD':  'NASDAQ:CRWD',
    'CSCO':  'NASDAQ:CSCO',
    'CSX':   'NASDAQ:CSX',
    'CTAS':  'NASDAQ:CTAS',
    'CTSH':  'NASDAQ:CTSH',
    'DLTR':  'NASDAQ:DLTR',
    'DOCU':  'NASDAQ:DOCU',
    'DXCM':  'NASDAQ:DXCM',
    'TTWO':  'NASDAQ:TTWO',
    'EBAY':  'NASDAQ:EBAY',
    'GOOG':  'NASDAQ:GOOG',
    'GOOGL': 'NASDAQ:GOOGL',
    'HON':   'NASDAQ:HON',
    'IDXX':  'NASDAQ:IDXX',
    'ILMN':  'NASDAQ:ILMN',
    'INCY':  'NASDAQ:INCY',
    'INTC':  'NASDAQ:INTC',
    'INTU':  'NASDAQ:INTU',
    'ISRG':  'NASDAQ:ISRG',
    'JD':    'NASDAQ:JD',
    'KDP':   'NASDAQ:KDP',
    'KHC':   'NASDAQ:KHC',
    'KLAC':  'NASDAQ:KLAC',
    'LRCX':  'NASDAQ:LRCX',
    'LULU':  'NASDAQ:LULU',
    'MAR':   'NASDAQ:MAR',
    'MCHP':  'NASDAQ:MCHP',
    'MDLZ':  'NASDAQ:MDLZ',
    'MELI':  'NASDAQ:MELI',
    'META':  'NASDAQ:META',
    'MNST':  'NASDAQ:MNST',
    'MRNA':  'NASDAQ:MRNA',
    'MRVL':  'NASDAQ:MRVL',
    'MSFT':  'NASDAQ:MSFT',
    'MU':    'NASDAQ:MU',
    'NVDA':  'NASDAQ:NVDA',
    'NXPI':  'NASDAQ:NXPI',
    'ON':    'NASDAQ:ON',
    'ORLY':  'NASDAQ:ORLY',
    'PAYX':  'NASDAQ:PAYX',
    'PCAR':  'NASDAQ:PCAR',
    'PDD':   'NASDAQ:PDD',
    'PEP':   'NASDAQ:PEP',
    'PLTR':  'NASDAQ:PLTR',
    'PTON':  'NASDAQ:PTON',
    'PYPL':  'NASDAQ:PYPL',
    'QCOM':  'NASDAQ:QCOM',
    'REGN':  'NASDAQ:REGN',
    'ROST':  'NASDAQ:ROST',
    'SBUX':  'NASDAQ:SBUX',
    'SIRI':  'NASDAQ:SIRI',
    'SNPS':  'NASDAQ:SNPS',
    'SOFI':  'NASDAQ:SOFI',
    'SWKS':  'NASDAQ:SWKS',
    'TCOM':  'NASDAQ:TCOM',
    'TEAM':  'NASDAQ:TEAM',
    'TMUS':  'NASDAQ:TMUS',
    'TSLA':  'NASDAQ:TSLA',
    'TXN':   'NASDAQ:TXN',
    'VRSK':  'NASDAQ:VRSK',
    'VRSN':  'NASDAQ:VRSN',
    'VRTX':  'NASDAQ:VRTX',
    'WDAY':  'NASDAQ:WDAY',
    'XEL':   'NASDAQ:XEL',

    # ── Additional NYSE stocks (S&P 500) ──
    'LLY':   'NYSE:LLY',
    'PFE':   'NYSE:PFE',
    'ABBV':  'NYSE:ABBV',
    'BMY':   'NYSE:BMY',
    'CI':    'NYSE:CI',
    'HUM':   'NYSE:HUM',
    'CVS':   'NYSE:CVS',
    'ABT':   'NYSE:ABT',
    'DHR':   'NYSE:DHR',
    'SYK':   'NYSE:SYK',
    'BSX':   'NYSE:BSX',
    'MDT':   'NYSE:MDT',
    'TMO':   'NYSE:TMO',
    'EW':    'NYSE:EW',
    'IQV':   'NYSE:IQV',
    'XOM':   'NYSE:XOM',
    'COP':   'NYSE:COP',
    'SLB':   'NYSE:SLB',
    'MPC':   'NYSE:MPC',
    'VLO':   'NYSE:VLO',
    'PSX':   'NYSE:PSX',
    'EOG':   'NYSE:EOG',
    'OXY':   'NYSE:OXY',
    'DVN':   'NYSE:DVN',
    'MS':    'NYSE:MS',
    'BLK':   'NYSE:BLK',
    'SCHW':  'NYSE:SCHW',
    'CB':    'NYSE:CB',
    'MCO':   'NYSE:MCO',
    'SPGI':  'NYSE:SPGI',
    'ICE':   'NYSE:ICE',
    'CME':   'NASDAQ:CME',
    'AIG':   'NYSE:AIG',
    'MET':   'NYSE:MET',
    'AFL':   'NYSE:AFL',
    'PGR':   'NYSE:PGR',
    'MMC':   'NYSE:MMC',
    'AON':   'NYSE:AON',
    'WTW':   'NASDAQ:WTW',
    'FISV':  'NASDAQ:FISV',
    'FIS':   'NYSE:FIS',
    'TGT':   'NYSE:TGT',
    'LOW':   'NYSE:LOW',
    'HLT':   'NYSE:HLT',
    'DAL':   'NYSE:DAL',
    'UAL':   'NASDAQ:UAL',
    'F':     'NYSE:F',
    'GM':    'NYSE:GM',
    'RTX':   'NYSE:RTX',
    'LMT':   'NYSE:LMT',
    'NOC':   'NYSE:NOC',
    'GD':    'NYSE:GD',
    'FDX':   'NYSE:FDX',
    'NSC':   'NYSE:NSC',
    'EMR':   'NYSE:EMR',
    'ETN':   'NYSE:ETN',
    'LIN':   'NASDAQ:LIN',
    'APD':   'NYSE:APD',
    'SHW':   'NYSE:SHW',
    'NEM':   'NYSE:NEM',
    'FCX':   'NYSE:FCX',
    'AMT':   'NYSE:AMT',
    'PLD':   'NYSE:PLD',
    'CCI':   'NYSE:CCI',
    'EQIX':  'NASDAQ:EQIX',
    'SPG':   'NYSE:SPG',
    'WELL':  'NYSE:WELL',
    'PSA':   'NYSE:PSA',
    'D':     'NYSE:D',
    'EXC':   'NASDAQ:EXC',
    'WEC':   'NYSE:WEC',
    'AES':   'NYSE:AES',
    'HCA':   'NYSE:HCA',

    # ── Japanese stocks — TradingView requires numeric ticker, not company name ──
    'FANUC':     'TSE:6954',
    'KEYENCE':   'TSE:6861',
    'TOKYOELEC': 'TSE:8035',
    'TOYOTA':    'TSE:7203',
    'SONY':      'TSE:6758',
    'HONDA':     'TSE:7267',
    'MUFG':      'TSE:8306',
    'NTT':       'TSE:9432',
    'SOFTBANK':  'TSE:9984',

    # ── AI Theme ──
    'C3AI':      'NYSE:AI',
    'SOUN':      'NASDAQ:SOUN',
    'BBAI':      'NYSE:BBAI',
    'CEREBRAS':  'NASDAQ:CBRS',
    'CRWV':      'NASDAQ:CRWV',
    'SPACEX':    'NASDAQ:SPCX',

    # ── Blockchain ──
    'COIN':      'NASDAQ:COIN',
    'MARA':      'NASDAQ:MARA',
    'RIOT':      'NASDAQ:RIOT',
    'MSTR':      'NASDAQ:MSTR',
    'CLSK':      'NASDAQ:CLSK',
    'HUT':       'NASDAQ:HUT',
    'WULF':      'NASDAQ:WULF',
    'IREN':      'NASDAQ:IREN',
    'HOOD':      'NASDAQ:HOOD',

    # ── Space ──
    'RKLB':      'NASDAQ:RKLB',
    'ASTS':      'NASDAQ:ASTS',
    'LUNR':      'NASDAQ:LUNR',
    'IRDM':      'NASDAQ:IRDM',
    'PLANET':    'NYSE:PL',
    'GSAT':      'NASDAQ:GSAT',
    'VSAT':      'NASDAQ:VSAT',
    'RDW':       'NYSE:RDW',

    # ── Quantum ──
    'IONQ':      'NYSE:IONQ',
    'RGTI':      'NASDAQ:RGTI',
    'QBTS':      'NYSE:QBTS',
    'QUBT':      'NASDAQ:QUBT',

    # ── Robotics ──
    'PATH':      'NYSE:PATH',
    'SYM':       'NASDAQ:SYM',
    'ROK':       'NYSE:ROK',
    'CGNX':      'NASDAQ:CGNX',
    'SERV':      'NASDAQ:SERV',
    'GMED':      'NYSE:GMED',

    # ── AI Energy ──
    'VST':       'NYSE:VST',
    'NRG':       'NYSE:NRG',
    'BWXT':      'NYSE:BWXT',
    'OKLO':      'NYSE:OKLO',
    'GEV':       'NYSE:GEV',
    'TLN':       'NASDAQ:TLN',
    'BE':        'NYSE:BE',

    # ── AI Semi ──
    'ALAB':      'NASDAQ:ALAB',
    'CRDO':      'NASDAQ:CRDO',
    'LSCC':      'NASDAQ:LSCC',
    'GFS':       'NASDAQ:GFS',
    'AMKR':      'NASDAQ:AMKR',
    'CAMT':      'NASDAQ:CAMT',
    'FN':        'NYSE:FN',

    # ── AI Infra ──
    'VRT':       'NYSE:VRT',
    'DLR':       'NYSE:DLR',
    'HPE':       'NYSE:HPE',
    'CLS':       'NYSE:CLS',
    'WDC':       'NASDAQ:WDC',
    'STX':       'NASDAQ:STX',
    'CIEN':      'NYSE:CIEN',
    'MDB':       'NASDAQ:MDB',
    'IRM':       'NYSE:IRM',
    'PWR':       'NYSE:PWR',

    # ── XM Thematic Indices (ETF proxies) ──
    'AI_INDX':   'NASDAQ:AIQ',
    'BCHAIN_NFT':'NASDAQ:BKCH',
    'FAANGS_10': 'NASDAQ:QQQ',
    'EV_INDX':   'NASDAQ:DRIV',
    'CHINA_NET': 'AMEX:KWEB',

    # ── Forex→AI/tech replacement batch (2026-07-11) — NYSE-listed names ──
    'COHR': 'NYSE:COHR', 'APH':  'NYSE:APH',  'GLW':  'NYSE:GLW',
    'JBL':  'NYSE:JBL',  'KEYS': 'NYSE:KEYS', 'TEL':  'NYSE:TEL',
    'TDY':  'NYSE:TDY',  'AME':  'NYSE:AME',  'ONTO': 'NYSE:ONTO',
    'S':    'NYSE:S',    'SMR':  'NYSE:SMR',  'HUBB': 'NYSE:HUBB',
    'NVT':  'NYSE:NVT',  'EME':  'NYSE:EME',  'JOBY': 'NYSE:JOBY',
    'ACHR': 'NYSE:ACHR', 'DT':   'NYSE:DT',   'IOT':  'NYSE:IOT',
    'ESTC': 'NYSE:ESTC', 'RDDT': 'NYSE:RDDT', 'GRMN': 'NYSE:GRMN',
    'SPOT': 'NYSE:SPOT', 'RBLX': 'NYSE:RBLX', 'NU':   'NYSE:NU',
    'SE':   'NYSE:SE',   'BABA': 'NYSE:BABA', 'BLOCK': 'NYSE:XYZ',
    'GDDY': 'NYSE:GDDY', 'HUBS': 'NYSE:HUBS', 'VEEV': 'NYSE:VEEV',
    'TOST': 'NYSE:TOST', 'TWLO': 'NYSE:TWLO',
}
