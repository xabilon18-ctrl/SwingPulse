"""Closed-bar workflow parity, causal higher-timeframe references and ledger isolation."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'webapp')]
from workflow_signals import add_workflow_signals,RULE_VERSION
from trend_context_feed import frame_context
from setup_context import reference_history,attach_setup_context
import signal_ledger

class WorkflowTests(unittest.TestCase):
    def frame(self, values, frequency='D'):
        return pd.DataFrame({'Close':values,'Open':values,'High':[v+1 for v in values],
            'Low':[v-1 for v in values],'Volume':100},index=pd.date_range('2000-01-01',periods=len(values),freq=frequency))
    def test_new_anchor_crosses_even_when_ribbon_not_ordered(self):
        f=self.frame([100]*500+[110]*12+[90,110,90])
        for tf in ('D','4H'):
            signal=add_workflow_signals(f,tf)
            self.assertEqual(signal.primary_signal.iloc[-3:].tolist(),['S1','B1','S1'])
            feed=frame_context(f,tf,now='2030-01-01')
            self.assertEqual([e['code'] for e in feed['events'][-3:]],['S1','B1','S1'])
            self.assertEqual(signal.established_trend.iloc[-1],feed['direction'])
    def test_prefix_replay_does_not_read_future_bars(self):
        f=self.frame([100]*500+[110]*12+[90]*10+[110]*10)
        full=add_workflow_signals(f,'4H')
        for end in (501,512,513,522):
            part=add_workflow_signals(f.iloc[:end],'4H')
            self.assertEqual(full.primary_signal.iloc[end-1],part.primary_signal.iloc[-1])
    def test_short_history_never_substitutes_ma250_for_main(self):
        out=add_workflow_signals(self.frame([100]*299+[110]),'D')
        self.assertTrue(out.primary_signal.eq('').all())
        self.assertEqual(out.trend_direction.iloc[-1],'NEUTRAL')
    def test_forming_periods_do_not_enter_references(self):
        f=self.frame([100]*11000)
        now=f.index[-1]+pd.Timedelta(hours=12)
        a=reference_history(f,now)
        altered=f.copy();altered.iloc[-1,altered.columns.get_loc('Close')]=100000
        self.assertEqual(a,reference_history(altered,now))
        self.assertTrue(a['W500']); self.assertTrue(a['M50'])
        for points in a.values(): self.assertTrue(all(t<=pd.Timestamp(now,tz='UTC').timestamp() for t,v in points))
        # All references, including W and M, are made from this instrument's own history.
        self.assertTrue(all(v==100 for name,points in a.items() if name!='ATR' for t,v in points))
    def test_minor_cross_before_native_500_in_both_directions(self):
        for main, native, prices, expected in [('UPTREND','UPTREND',[101,99],'DOWNTREND'),('DOWNTREND','DOWNTREND',[99,101],'UPTREND')]:
            t=int(pd.Timestamp('2026-10-01',tz='UTC').timestamp())
            daily={'context':{'direction':main},'references':{'D50':[[t,100]],'ATR':[[t,2]],'W250':[[t,95]],'M50':[[t,95.1]]}}
            hourly={'t':['2026-10-09 00:00','2026-10-09 04:00','2026-10-09 08:00'],
                    'c':prices+[0], 'h':[102]*3,'l':[98]*3,'context':{'direction':native}}
            built={'D':{'X':daily},'4H':{'X':hourly}}
            attach_setup_context(built,now='2026-10-09 08:30')
            self.assertEqual(hourly['context']['swingDirection'],expected)
            self.assertEqual(hourly['context']['setup']['price'],prices[-1])
            self.assertEqual(daily['context']['direction'],main)
            self.assertEqual(hourly['context']['setup']['minorOpportunity']['at'],'2026-10-09 04:00')
    def test_ledger_separates_rules_and_exact_four_hour_fires(self):
        records={'old':{'id':'old','instrument':'X','fire_date':'2026-10-01','tf':'D','code':'B1','trade':None}}
        row={'instrument_name':'X','group':'Crypto','signal_rule_version':RULE_VERSION,
             'primary_signal':'B1','date':'2026-10-10','h4_primary_signal':'S1','h4_date':'2026-10-10','h4_datetime':'2026-10-10 04:00'}
        self.assertEqual(signal_ledger.record_fires_from_row(records,row,'X'),2)
        self.assertEqual(signal_ledger.record_fires_from_row(records,row,'X'),0)
        row['h4_datetime']='2026-10-10 12:00'
        self.assertEqual(signal_ledger.record_fires_from_row(records,row,'X'),1)
        with tempfile.TemporaryDirectory() as temp,patch.object(signal_ledger,'SUMMARY_PATH',str(Path(temp)/'summary.json')),patch.object(signal_ledger,'OUTPUT_DIR',temp):
            summary=signal_ledger.write_summary(records)
        self.assertEqual(summary['totals']['fires'],3)
        self.assertEqual(summary['legacy_fires'],1)
        self.assertIn('old',records)
    def test_new_ledger_never_guesses_missing_fire_time(self):
        f=self.frame([100,101,102],'4h')
        record={'rule_version':RULE_VERSION,'tf':'4H','fire_time':'2000-01-01 06:00','fire_date':'2000-01-01'}
        self.assertEqual(signal_ledger._fire_index(f,record),(None,False))

if __name__=='__main__':unittest.main()
