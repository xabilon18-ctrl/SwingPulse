"""
SwingPulse — Interactive trading signal dashboard.

Run:
    cd swing_generator/webapp
    python server.py

Then open http://localhost:5050
"""

from __future__ import annotations

import glob
import os
import sys
from datetime import datetime

import pandas as pd
from flask import Flask, jsonify, render_template, send_file

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
OUTPUT_DIR = os.path.join(PARENT_DIR, 'output')
CACHE_DIR  = os.path.join(PARENT_DIR, 'cache')

# Allow importing config from parent package
sys.path.insert(0, PARENT_DIR)

MA_PERIODS = list(range(40, 201, 10))  # 40, 50, 60 ... 200

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
    # ── Commodities (TVC) ──
    'GOLD':     'TVC:GOLD',
    'SILVER':   'TVC:SILVER',
    'USOIL':    'TVC:USOIL',
    'WTI':      'TVC:USOIL',

    # ── Indices (matched to user's brokers) ──
    'US100':    'CAPITALCOM:US100',
    'US500':    'CAPITALCOM:US500',
    'SW20':     'CAPITALCOM:SW20',
    'UK100':    'CFI:UK100',
    'IT40':     'FOREXCOM:IT40',
    'US30':     'FX:US30',
    'FRA40':    'FX:FRA40',
    'NETH25':   'ICMARKETS:NETH25',
    'RUSSELL':  'IG:RUSSELL',
    'DAX':      'IG:DAX',
    'XINHUA':   'IG:XINHUA',
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
    'WMT':  'NYSE:WMT',
    'BUD':  'NYSE:BUD',
    'APOLLO': 'NYSE:APO',

    # ── Other US exchanges ──
    'ORCL':  'NYSE:ORCL',
    'TSM':   'NYSE:TSM',
    'UBER':  'NYSE:UBER',

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
    'NGAS':      'TVC:NATURALGAS',
    'PLATINUM':  'TVC:PLATINUM',
    'PALLADIUM': 'TVC:PALLADIUM',
    'COPPER':    'TVC:COPPER',
    'CORN':      'CBOT:ZC1!',
    'WHEAT':     'CBOT:ZW1!',
    'SUGAR':     'ICEUS:SB1!',
    'COFFEE':    'ICEUS:KC1!',
    'COCOA':     'ICEUS:CC1!',
    'SOYBEANS':  'CBOT:ZS1!',
    'COTTON':    'ICEUS:CT1!',

    # ── New Indices ──
    'AUS200':    'CAPITALCOM:AUS200',
    'SA40':      'CAPITALCOM:SA40',
    'VIX':       'TVC:VIX',
    'USDX':      'TVC:DXY',

    # ── New Crypto (BINANCE) ──
    'ADAUSDT':   'BINANCE:ADAUSDT',
    'LTCUSDT':   'BINANCE:LTCUSDT',
    'BCHUSDT':   'BINANCE:BCHUSDT',
    'XLMUSDT':   'BINANCE:XLMUSDT',
    'ETCUSDT':   'BINANCE:ETCUSDT',
    'TRXUSDT':   'BINANCE:TRXUSDT',
    'NEARUSDT':  'BINANCE:NEARUSDT',
    'MATICUSDT': 'BINANCE:MATICUSDT',
    'FILUSDT':   'BINANCE:FILUSDT',
    'THETAUSDT': 'BINANCE:THETAUSDT',
    'SANDUSDT':  'BINANCE:SANDUSDT',
    'MANAUSDT':  'BINANCE:MANAUSDT',
    'ARBUSDT':   'BINANCE:ARBUSDT',
    'LDOUSDT':   'BINANCE:LDOUSDT',
    'GRTUSDT':   'BINANCE:GRTUSDT',
    'FTMUSDT':   'BINANCE:FTMUSDT',
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
    'BAE':       'LSE:BA',
    'RR_UK':     'LSE:RR',
    'NG_UK':     'LSE:NG',
    'RELX':      'LSE:REL',
    'JD_UK':     'LSE:JD',

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
    'ROG_SW':    'SIX:ROG',

    # ── Australian (ASX) stocks — special name overrides ──
    'TCL_AX':    'ASX:TCL',
    'ALL_AX':    'ASX:ALL',

    # ── South African (JSE) stocks — special name overrides ──
    'SOL_ZA':    'JSE:SOL',
    'DSY_ZA':    'JSE:DSY',

    # ── Scandinavian stocks — name overrides (hyphenated tickers) ──
    'VOLVB':     'STO:VOLV-B',
    'ERICB':     'STO:ERIC-B',
    'HMB':       'STO:HM-B',
    'SWEDA':     'STO:SWED-A',
    'SEBA':      'STO:SEB-A',
    'ATCOA':     'STO:ATCO-A',
    'NOVOB':     'CPH:NOVO-B',
    'MAERSKB':   'CPH:MAERSK-B',

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
    'EA':    'NASDAQ:EA',
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
    'HES':   'NYSE:HES',
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
    'WTW':   'NYSE:WTW',
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
    'LIN':   'NYSE:LIN',
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
}

# NYSE stocks that appear under different ticker in TV
_NYSE_SET = {
    'BA','CVX','IBM','JPM','AXP','CRM','GS','KO','PG','HD','V','DOW',
    'TRV','DIS','CAT','NKE','JNJ','VZ','MCD','MRK','MMM','UNH','WMT','BUD',
}


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

        # 4. Remaining (NASDAQ-listed US stocks, etc.) — no prefix needed,
        #    TradingView auto-resolves these correctly.
        result[name] = name

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
    return render_template('index.html')


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


@app.route('/api/summary')
def api_summary():
    df, dt = get_signals()
    if df.empty:
        return jsonify({})

    trend_counts = df['trend_direction'].value_counts().to_dict()

    buy_mask = df['confirmation_status'].str.contains('buy', case=False, na=False)
    sell_mask = df['confirmation_status'].str.contains('sell', case=False, na=False)

    signal_types = df['primary_signal'].value_counts().to_dict()
    signal_types.pop('', None)

    groups = sorted([g for g in df['group'].unique().tolist() if g])

    return jsonify({
        'date': dt,
        'total': len(df),
        'trend_counts': trend_counts,
        'buy_count': int(buy_mask.sum()),
        'sell_count': int(sell_mask.sum()),
        'watch_count': int((df['watch_flag'] != '').sum()),
        'volume_spikes': int((df['volume_spike_flag'] == 'yes').sum()),
        'key_level_touches': int((df['key_level_touched_today'] == 'yes').sum()),
        'turning_points': int((df['potential_turning_point_flag'] != '').sum()),
        'signal_types': signal_types,
        'groups': groups,
        'fetched_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
    })


@app.route('/api/ticker-map')
def api_ticker_map():
    """Return the display-name → ticker mapping so the frontend can resolve chart requests."""
    return jsonify(get_ticker_map())


@app.route('/api/tv-map')
def api_tv_map():
    """Return display-name → TradingView symbol mapping."""
    return jsonify(build_tv_map())


@app.route('/api/history/<name>')
def api_history(name: str):
    """Return last 250 days of OHLCV + MAs for charting.
    Accepts either a display name (e.g. AAPL) or a raw ticker (e.g. GC=F)."""
    tm = get_ticker_map()
    ticker = tm.get(name, name)  # try display name first, fall back to raw
    path = os.path.join(CACHE_DIR, _ticker_to_filename(ticker))
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404

    df = pd.read_parquet(path).tail(250).copy()

    for p in MA_PERIODS:
        col = f'ma_{p}'
        if col not in df.columns:
            # Compute on the full dataset for accuracy, then slice
            full = pd.read_parquet(path)
            full[col] = full['Close'].rolling(p, min_periods=p).mean()
            df[col] = full[col].tail(250)

    df.index = df.index.strftime('%Y-%m-%d')
    records = []
    for dt_str, row in df.iterrows():
        rec = {
            'date': dt_str,
            'open': round(float(row.get('Open', 0)), 4),
            'high': round(float(row.get('High', 0)), 4),
            'low': round(float(row.get('Low', 0)), 4),
            'close': round(float(row.get('Close', 0)), 4),
            'volume': int(row.get('Volume', 0)),
        }
        for p in MA_PERIODS:
            v = row.get(f'ma_{p}')
            if pd.notna(v):
                rec[f'ma_{p}'] = round(float(v), 4)
        records.append(rec)

    return jsonify({'ticker': ticker, 'data': records})


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


@app.route('/api/explanations')
def api_explanations():
    """Return pre-generated AI signal explanations."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'explanations.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/portfolio')
def api_portfolio():
    """Serve portfolio.json from output dir (parsed from XM email)."""
    pf_path = os.path.join(OUTPUT_DIR, 'portfolio.json')
    if os.path.exists(pf_path):
        return send_file(pf_path, mimetype='application/json')
    return jsonify(None)


@app.route('/api/refresh', methods=['POST'])
def api_refresh():
    """Clear data cache so next request loads fresh CSV."""
    _data_cache.clear()
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    print('\n  SwingPulse Dashboard')
    print('  http://localhost:5050\n')
    app.run(debug=False, host='0.0.0.0', port=5050)
