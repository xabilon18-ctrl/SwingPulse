"""
SwingPulse — Interactive trading signal dashboard.

Run:
    cd swing_generator/webapp
    python server.py

Then open http://localhost:5050
"""

from __future__ import annotations

import glob
import gzip
import json
import os
import sys
from datetime import datetime

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
OUTPUT_DIR = os.path.join(PARENT_DIR, 'output_ma500')
CACHE_DIR  = os.path.join(PARENT_DIR, 'cache_ma500')

# Allow importing config from parent package
sys.path.insert(0, PARENT_DIR)

from _active_config import MA_PERIODS  # MA25–MA500 (active profile ribbon)

sys.path.insert(0, BASE_DIR)
import chart_feed          # compact OHLC + ribbon bundles for the Charts reel

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['TEMPLATES_AUTO_RELOAD'] = True

# ---------------------------------------------------------------------------
# Instrument name→ticker mapping
# ---------------------------------------------------------------------------

def _load_ticker_map() -> dict[str, str]:
    """Build a display-name → ticker mapping from the instruments file."""
    from instruments import load_instruments
    return {inst['name']: inst['ticker'] for inst in load_instruments()}


_ticker_map: dict[str, str] | None = None


def get_ticker_map() -> dict[str, str]:
    global _ticker_map
    if _ticker_map is None:
        _ticker_map = _load_ticker_map()
    return _ticker_map


# ---------------------------------------------------------------------------
# Display-name → TradingView symbol mapping
# Matched to the user's exact TradingView watchlist & exchanges
# ---------------------------------------------------------------------------

# Direct overrides: display_name → EXCHANGE:SYMBOL
_TV_BY_NAME: dict[str, str] = {
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
    'FRA40':    'FX:FRA40',
    'NETH25':   'ICMARKETS:NETH25',
    'RUSSELL':  'CAPITALCOM:RTY',
    'DAX':      'IG:DAX',
    'CHINA50':  'AMEX:FXI',
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

# NYSE stocks that appear under different ticker in TV
_NYSE_SET = {
    'BA','CVX','IBM','JPM','AXP','CRM','GS','KO','PG','HD','V','DOW',
    'TRV','DIS','CAT','NKE','JNJ','VZ','MCD','MRK','MMM','UNH','WMT','BUD',
}

# ---------------------------------------------------------------------------
# Artificial Intelligence universe — instruments with material AI exposure
# Add new names here; they get picked up automatically by the app.
# ---------------------------------------------------------------------------
_AI_INSTRUMENTS: set[str] = {
    # ── AI Chips & Fabless Silicon ──
    'NVDA',   # NVIDIA — dominant AI GPU
    'AMD',    # AI GPUs & CPUs
    'AVGO',   # Broadcom — AI networking ASICs
    'ARM',    # ARM Holdings — AI chip architecture
    'MRVL',   # Marvell — AI networking chips
    'INTC',   # Intel — Gaudi AI accelerators
    'ON',     # ON Semiconductor — AI edge chips
    'QCOM',   # Qualcomm — edge AI / NPUs
    'NXPI',   # NXP — automotive AI silicon
    'STM',    # STMicroelectronics — edge AI
    'MPWR',   # Monolithic Power Systems — AI power delivery
    'AMBA',   # Ambarella — AI edge vision chips

    # ── AI Server & Data-Centre Hardware ──
    'SMCI',   # Super Micro Computer — AI server racks
    'DELL',   # Dell — AI server infrastructure
    'ANET',   # Arista Networks — AI data-centre networking
    'CSCO',   # Cisco — AI networking
    'IBM',    # IBM — Watson AI / Granite models

    # ── Chip Design Tools (EDA) ──
    'CDNS',   # Cadence Design Systems
    'SNPS',   # Synopsys

    # ── Semiconductor Equipment (AI supply chain) ──
    'ASML',       # ASML — EUV lithography, essential for AI chips
    'AMAT',       # Applied Materials — wafer processing
    'LRCX',       # Lam Research — etch & deposition
    'KLAC',       # KLA Corporation — chip inspection
    'ENTG',       # Entegris — semiconductor materials
    'TOKYOELEC',  # Tokyo Electron — semiconductor equipment
    'BESI',       # BE Semiconductor — advanced AI chip packaging (AEX)
    'TER',        # Teradyne — chip testing equipment

    # ── AI Mega-caps & Cloud AI Platforms ──
    'MSFT',   # Microsoft — Azure AI, OpenAI partnership
    'GOOGL',  # Alphabet — Gemini, DeepMind
    'GOOG',   # Alphabet Class C
    'META',   # Meta — Llama, AI research
    'AMZN',   # Amazon — AWS Bedrock, Trainium
    'TSLA',   # Tesla — FSD, Dojo, Optimus robot
    'AAPL',   # Apple — Apple Intelligence, CoreML

    # ── AI Data, Analytics & Observability ──
    'PLTR',   # Palantir — AI analytics & AIP
    'SNOW',   # Snowflake — AI data platform
    'DDOG',   # Datadog — AI observability
    'NET',    # Cloudflare — Workers AI / edge inference

    # ── AI Enterprise Software ──
    'CRM',    # Salesforce — Einstein AI
    'NOW',    # ServiceNow — Now Assist AI
    'WDAY',   # Workday — AI HR & Finance
    'INTU',   # Intuit — AI fintech (Intuit Assist)
    'ADBE',   # Adobe — Firefly AI creative
    'ORCL',   # Oracle — AI database / OCI
    'SAP_DE', # SAP — Joule AI copilot

    # ── AI Cybersecurity ──
    'CRWD',   # CrowdStrike — AI endpoint security
    'PANW',   # Palo Alto Networks — AI SASE
    'ZS',     # Zscaler — AI zero-trust
    'APP',    # AppLovin — AI ad optimisation engine

    # ── AI Robotics & Industrial Automation ──
    'SOFTBANK',  # SoftBank — AI Vision Fund, ARM owner
    'KEYENCE',   # Keyence — AI machine vision & sensors
    'FANUC',     # Fanuc — AI robotics & CNC

    # ── AI Industrial / Enterprise (Europe) ──
    'SIE',    # Siemens — Industrial AI & digital twin
    'IFX',    # Infineon — AI automotive & industrial chips
    'CAP_FR', # Capgemini — AI consulting & transformation
    'DSY',    # Dassault Systèmes — AI simulation & PLM
    'ERICB',  # Ericsson — AI-enabled 5G networks

    # ── AI Data & Analytics (UK/Europe) ──
    'EXPN',   # Experian — AI credit & data analytics
    'RELX',   # RELX — AI legal & scientific analytics
    'LSEG',   # London Stock Exchange Group — AI market data
}


def build_ai_set() -> list[str]:
    """Return sorted list of AI-flagged instrument names."""
    return sorted(_AI_INSTRUMENTS)


def build_tv_map() -> dict[str, str]:
    """Return display-name → TradingView symbol mapping.

    Priority:
      1. Explicit _TV_BY_NAME override (indices, crypto, NYSE, commodities)
      2. German stocks (.DE tickers)  → XETR:name
      3. Forex (=X tickers)           → FX:name
      4. Remaining US stocks           → NASDAQ:name (or name alone)
    """
    tm = get_ticker_map()           # {display_name: yahoo_ticker}
    result: dict[str, str] = {}

    for name, yf_ticker in tm.items():
        # 1. Exact override
        if name in _TV_BY_NAME:
            result[name] = _TV_BY_NAME[name]
            continue

        # 2. German stocks: *.DE → XETR:name
        #    Strip _DE suffix from display names (e.g. SAP_DE → XETR:SAP)
        if yf_ticker.endswith('.DE'):
            tv_sym = name[:-3] if name.endswith('_DE') else name
            result[name] = f'XETR:{tv_sym}'
            continue

        # 2b. Spanish stocks: *.MC → BME:name
        if yf_ticker.endswith('.MC'):
            result[name] = f'BME:{name}'
            continue

        # 2c. Canadian stocks: *.TO → TSX:name
        if yf_ticker.endswith('.TO'):
            result[name] = f'TSX:{name}'
            continue

        # 2d. UK stocks: *.L → LSE:name  (strip _UK suffix if present)
        if yf_ticker.endswith('.L'):
            tv_sym = name[:-3] if name.endswith('_UK') else name
            result[name] = f'LSE:{tv_sym}'
            continue

        # 2e. French stocks: *.PA → EURONEXT:name  (strip _FR suffix if present)
        if yf_ticker.endswith('.PA'):
            tv_sym = name[:-3] if name.endswith('_FR') else name
            result[name] = f'EURONEXT:{tv_sym}'
            continue

        # 2f. Italian stocks: *.MI → MIL:name  (strip _IT suffix if present)
        if yf_ticker.endswith('.MI'):
            tv_sym = name[:-3] if name.endswith('_IT') else name
            result[name] = f'MIL:{tv_sym}'
            continue

        # 2g. Dutch stocks: *.AS → EURONEXT:name  (strip _NL suffix if present)
        if yf_ticker.endswith('.AS'):
            tv_sym = name[:-3] if name.endswith('_NL') else name
            result[name] = f'EURONEXT:{tv_sym}'
            continue

        # 2h. Swiss stocks: *.SW → SIX:name  (strip _SW suffix if present)
        if yf_ticker.endswith('.SW'):
            tv_sym = name[:-3] if name.endswith('_SW') else name
            result[name] = f'SIX:{tv_sym}'
            continue

        # 2i. Australian stocks: *.AX → ASX:name  (strip _AX suffix if present)
        if yf_ticker.endswith('.AX'):
            tv_sym = name[:-3] if name.endswith('_AX') else name
            result[name] = f'ASX:{tv_sym}'
            continue

        # 2j. Japanese stocks: *.T → TSE:name
        if yf_ticker.endswith('.T'):
            result[name] = f'TSE:{name}'
            continue

        # 2k. South African stocks: *.JO → JSE:name  (strip _ZA suffix if present)
        if yf_ticker.endswith('.JO'):
            tv_sym = name[:-3] if name.endswith('_ZA') else name
            result[name] = f'JSE:{tv_sym}'
            continue

        # 2l. Swedish stocks: *.ST → STO:name
        if yf_ticker.endswith('.ST'):
            result[name] = f'STO:{name}'
            continue

        # 2m. Norwegian stocks: *.OL → OSL:name
        if yf_ticker.endswith('.OL'):
            result[name] = f'OSL:{name}'
            continue

        # 2n. Danish stocks: *.CO → CPH:name
        if yf_ticker.endswith('.CO'):
            result[name] = f'CPH:{name}'
            continue

        # 3. Forex pairs: *=X → FX:name
        if yf_ticker.endswith('=X'):
            result[name] = f'FX:{name}'
            continue

        # 4. Remaining US stocks — default to NASDAQ (NYSE ones are in _TV_BY_NAME)
        result[name] = f'NASDAQ:{name}'

    return result


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

_data_cache: dict = {}


def _ticker_to_filename(ticker: str) -> str:
    """Convert ticker symbol to parquet cache filename."""
    safe = (ticker
            .replace('=', '_EQ_')
            .replace('^', '_IDX_')
            .replace('.', '_DOT_'))
    return f'{safe}.parquet'


def load_latest_signals() -> tuple[pd.DataFrame, str]:
    """Load the most recent signals CSV."""
    files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'signals_*.csv')))
    if not files:
        return pd.DataFrame(), ''
    latest = files[-1]
    date_str = os.path.basename(latest).replace('signals_', '').replace('.csv', '')
    df = pd.read_csv(latest).fillna('')
    return df, date_str


def get_signals():
    """Cached signal data."""
    if 'signals' not in _data_cache:
        df, dt = load_latest_signals()
        _data_cache['signals'] = df
        _data_cache['date'] = dt
    return _data_cache['signals'], _data_cache['date']


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    # Patch the same template tokens publish.py patches for production, so
    # local dev doesn't show literal PROFILE_BADGE / __APP_PROFILE__ strings.
    html = render_template('index.html')
    html = html.replace('PROFILE_BADGE', 'MA500')
    html = html.replace('__APP_PROFILE__', 'ma500')
    html = html.replace('__SIG_SHORTEST__', str(min(MA_PERIODS)))
    html = html.replace('__SIG_LONGEST__', str(max(MA_PERIODS)))
    return html


@app.route('/sw.js')
def service_worker():
    return app.send_static_file('sw.js'), 200, {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/',
    }


@app.route('/api/signals')
def api_signals():
    df, dt = get_signals()
    return jsonify({'date': dt, 'data': df.to_dict(orient='records')})


@app.route('/api/status')
def api_status():
    """Pipeline health, mirroring the status.json publish.py writes to R2 (the
    CI failure step flips it to state:'failed'). Local dev has no CI, so a run
    that produced a signals file is reported ok."""
    df, dt = get_signals()
    if df.empty:
        return jsonify({'state': 'unknown'})
    return jsonify({'state': 'ok', 'at': None, 'date': str(dt)})


@app.route('/api/summary')
def api_summary():
    df, dt = get_signals()
    if df.empty:
        return jsonify({})

    try:
        trend_counts = df['trend_direction'].value_counts().to_dict() if 'trend_direction' in df.columns else {}

        # Signal codes are B1/B4 (buy) / S1/S4 (sell)
        sigs      = df['primary_signal'].fillna('').astype(str) if 'primary_signal' in df.columns else pd.Series('', index=df.index)
        buy_mask  = sigs.str.startswith('B')
        sell_mask = sigs.str.startswith('S')

        signal_types = df['primary_signal'].value_counts().to_dict() if 'primary_signal' in df.columns else {}
        signal_types.pop('', None)

        groups = sorted([g for g in df['group'].unique().tolist() if g]) if 'group' in df.columns else []

        # Coverage — kept identical to publish.py build_summary() so local dev
        # and the published payload never disagree about what's missing.
        try:
            from instruments import load_instruments
            expected  = load_instruments()
            published = set(df['instrument_name'].astype(str))
            missing   = sorted(i['name'] for i in expected if i['name'] not in published)
        except Exception:
            expected, missing = [], []

        return jsonify({
            'date': dt,
            'total': len(df),
            'expected': len(expected),
            'missing_count': len(missing),
            'missing': missing[:50],
            'trend_counts': trend_counts,
            'buy_count': int(buy_mask.sum()),
            'sell_count': int(sell_mask.sum()),
            'volume_spikes': int((df['volume_spike_flag'] == 'yes').sum()) if 'volume_spike_flag' in df.columns else 0,
            'key_level_touches': int((df['key_level_touched_today'] == 'yes').sum()) if 'key_level_touched_today' in df.columns else 0,
            'signal_types': signal_types,
            'groups': groups,
            'fetched_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
        })
    except Exception as e:
        app.logger.error(f'api_summary error: {e}')
        return jsonify({'date': dt, 'total': len(df), 'error': str(e)})


@app.route('/api/ticker-map')
def api_ticker_map():
    """Return the display-name → ticker mapping so the frontend can resolve chart requests."""
    return jsonify(get_ticker_map())


@app.route('/api/tv-map')
def api_tv_map():
    """Return display-name → TradingView symbol mapping."""
    return jsonify(build_tv_map())


@app.route('/api/ai-instruments')
def api_ai_instruments():
    """Return sorted list of AI-flagged instrument names."""
    return jsonify(build_ai_set())


# ---------------------------------------------------------------------------
# Chart reel feed
# ---------------------------------------------------------------------------
# Production serves these as static files from R2 (built by chart_feed.py during
# publish). Locally we build each chunk on demand and memoise it, so the reel
# shows whatever is in the parquet cache right now without a publish first.

_chart_chunk_cache: dict = {}

# ONE table — the route's timeframe whitelist reads this, it does not restate it.
_CHART_BUILDERS = {
    'D':  chart_feed.build_daily,
    '1H': chart_feed.build_1h,
    '4H': chart_feed.build_4h,
    '3D': chart_feed.build_3d,
    'W':  chart_feed.build_weekly,
}


def _chart_chunk_map() -> dict:
    """name -> chunk id, using the same sorted-name rule as the published feed."""
    names = sorted(get_ticker_map())
    return {n: i // chart_feed.CHUNK_SIZE for i, n in enumerate(names)}


@app.route('/api/chart-index')
def api_chart_index():
    return jsonify({
        'chunk_size': chart_feed.CHUNK_SIZE,
        'bars': chart_feed.BARS,
        'chunks': _chart_chunk_map(),
    })


@app.route('/api/chart/<tf>/<int:cid>')
def api_chart_chunk(tf: str, cid: int):
    # Keyed off the builder table below rather than a hand-copied tuple — the
    # two used to be separate lists and 3D was added to one of them, which is
    # how the reel got a 400 and drew "No chart data" for every instrument.
    if tf not in _CHART_BUILDERS:
        return jsonify({'error': 'bad timeframe'}), 400

    key = (tf, cid)
    if key in _chart_chunk_cache:
        return jsonify(_chart_chunk_cache[key])

    tm      = get_ticker_map()
    members = [n for n, c in _chart_chunk_map().items() if c == cid]
    builder = _CHART_BUILDERS[tf]

    data = {}
    for name in members:
        try:
            payload = builder(CACHE_DIR, tm[name])
        except Exception:
            payload = None       # one bad parquet must not empty the chunk
        if payload:
            data[name] = payload

    out = {'tf': tf, 'bars': chart_feed.BARS, 'data': data}
    _chart_chunk_cache[key] = out
    return jsonify(out)


@app.route('/api/trends')
def api_trends():
    """Return trend segment history for all instruments."""
    import json as _json
    # Load from the latest trends JSON generated by main.py
    trend_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'trends_*.json')))
    if not trend_files:
        return jsonify({})
    with open(trend_files[-1]) as f:
        return jsonify(_json.load(f))


@app.route('/api/ledger')
def api_ledger():
    """Return the live signal-ledger summary written by signal_ledger.py."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'ledger_summary.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/names')
def api_names():
    """Return {display_name: full company name} built by publish.py build_names().
    Reads the file the last publish wrote; empty until a publish has run."""
    import json as _json
    path = os.path.join(os.path.dirname(__file__), 'publish', 'data_ma500', 'names.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


# Radar files per timeframe — mirrors sector_activity.TF_SPECS. 4H has no radar
# (too little hourly history to build a baseline), so it falls back to daily.
_RADAR_FILES    = {'D': 'sector_radar.json',    '3D': 'sector_radar_3d.json',
                   'W': 'sector_radar_w.json'}
_ACTIVITY_FILES = {'D': 'sector_activity.json', '3D': 'sector_activity_3d.json',
                   'W': 'sector_activity_w.json'}


@app.route('/api/sector-radar-w')
def api_sector_radar_w():
    """Weekly radar under its own PATH. The published site is static JSON, so a
    '?tf=' query string cannot select a file there — publish.py rewrites paths,
    not query strings. Local and published must therefore agree on paths."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, _RADAR_FILES['W'])
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/sector-activity-w')
def api_sector_activity_w():
    """Weekly activity series — the radar info modal's sparkline source."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, _ACTIVITY_FILES['W'])
    if not os.path.exists(path):
        return jsonify(None)
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/sector-radar-3d')
def api_sector_radar_3d():
    """3-day radar under its own PATH, for the same reason the weekly one has
    its own: the published site is static JSON and publish.py rewrites paths,
    not query strings."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, _RADAR_FILES['3D'])
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/sector-activity-3d')
def api_sector_activity_3d():
    """3-day activity series — the radar info modal's sparkline source."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, _ACTIVITY_FILES['3D'])
    if not os.path.exists(path):
        return jsonify(None)
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/shape-similarity')
def api_shape_similarity():
    """Chart lookalikes + families, written by shape_similarity.py.

    Served gzipped from R2 in production; here the file on disk is gzip too, so
    read it back through gzip rather than json.load on a text handle.
    """
    path = os.path.join(OUTPUT_DIR, 'shape_similarity.json')
    if not os.path.exists(path):
        return jsonify({'neighbours': {}, 'families': [], 'family_of': {}})
    try:
        with gzip.open(path, 'rt') as fh:
            return jsonify(json.load(fh))
    except OSError:
        with open(path) as fh:          # tolerate an un-gzipped local build
            return jsonify(json.load(fh))


@app.route('/api/sector-radar')
def api_sector_radar():
    """Sector activity radar summary written by sector_activity.py.

    ?tf=W returns the weekly radar. Unknown or absent -> daily, so an old client
    that does not send the parameter keeps working unchanged."""
    import json as _json
    fname = _RADAR_FILES.get(request.args.get('tf', 'D'), _RADAR_FILES['D'])
    path = os.path.join(OUTPUT_DIR, fname)
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/sector-activity')
def api_sector_activity():
    """Per-day sector activity series — powers the radar info modal sparkline.
    572K, so the frontend lazy-loads it on first info-button tap, never at boot."""
    import json as _json
    fname = _ACTIVITY_FILES.get(request.args.get('tf', 'D'), _ACTIVITY_FILES['D'])
    path = os.path.join(OUTPUT_DIR, fname)
    if not os.path.exists(path):
        return jsonify(None)
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/instrument-flavours')
def api_instrument_flavours():
    """Per-instrument sector-mood map (provisional conviction layer)."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'instrument_flavours.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/backtest')
def api_backtest():
    """Return the latest backtest results generated by backtest.py."""
    import json as _json
    bt_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'backtest_*.json')))
    if not bt_files:
        return jsonify({})
    with open(bt_files[-1]) as f:
        return jsonify(_json.load(f))


@app.route('/api/explanations')
def api_explanations():
    """Return pre-generated AI signal explanations."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'explanations.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/events')
def api_events():
    """Scheduled events (earnings / ex-dividend) for the calendar tab."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'events.json')
    if not os.path.exists(path):
        return jsonify({'events': [], 'sources': {}})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/events.ics')
def events_ics():
    """The subscribable calendar feed, same path the published app serves.

    Added 2026-08-30. Without it `Subscribe in Calendar` and the one-day
    download were dead in local dev — webcal://localhost:5050/events.ics is a
    404 — so the only way to test either was to publish. Built by
    publish.build_ics(), which is the ONE place an event gets a calendar title;
    serving a second implementation here is how the two .ics files drifted in
    the first place.
    """
    import json as _json
    from flask import Response
    path = os.path.join(OUTPUT_DIR, 'events.json')
    events = []
    if os.path.exists(path):
        with open(path) as f:
            events = _json.load(f).get('events', [])
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from publish import build_ics
    # text/calendar, not application/json: iOS silently ignores a webcal://
    # subscription served as JSON (same reason publish._content_type_for exists).
    return Response(build_ics(events), mimetype='text/calendar')


@app.route('/api/flow')
def api_flow():
    """Aggregate index volume by region for the Flow tab."""
    group  = request.args.get('group',  'Indices')
    region = request.args.get('region', 'All')
    days   = min(int(request.args.get('days', 252)), 500)

    flow_path = os.path.join(OUTPUT_DIR, 'flow_volumes.csv')
    if not os.path.exists(flow_path):
        return jsonify({'group': group, 'region': region, 'data': [], 'stats': {}})

    try:
        df = pd.read_csv(flow_path)
        df = df[(df['group'] == group) & (df['region'] == region)].copy()
        df = df.sort_values('date').tail(days).reset_index(drop=True)
        df['total_volume'] = pd.to_numeric(df['total_volume'], errors='coerce').fillna(0)

        data = [
            {'date': row['date'], 'volume': int(row['total_volume']),
             'instrument_count': int(row.get('instrument_count', 0))}
            for _, row in df.iterrows()
        ]

        vols = [d['volume'] for d in data if d['volume'] > 0]
        recent = [d['volume'] for d in data[-30:] if d['volume'] > 0]
        stats = {
            'current':     data[-1]['volume'] if data else 0,
            'avg_30d':     round(sum(recent) / len(recent)) if recent else 0,
            'window_high': max(vols) if vols else 0,
            'window_low':  min(vols) if vols else 0,
            'mean':        round(sum(vols) / len(vols)) if vols else 0,
        }
        return jsonify({'group': group, 'region': region, 'data': data, 'stats': stats})
    except Exception as e:
        app.logger.error(f'api_flow error: {e}')
        return jsonify({'group': group, 'region': region, 'data': [], 'stats': {}, 'error': str(e)})


@app.route('/api/refresh', methods=['POST'])
def api_refresh():
    """Clear data cache so next request loads fresh CSV."""
    _data_cache.clear()
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    print('\n  SwingPulse Dashboard')
    print('  http://localhost:5050\n')
    app.run(debug=False, host='0.0.0.0', port=5050)
