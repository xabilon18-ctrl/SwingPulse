"""Regression checks for the completed-candle, MA500 direction rule."""
from pathlib import Path
import sys, unittest
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'webapp')]
from trend_context_feed import frame_context, workflow_context, workflow_alerts

class ContextTests(unittest.TestCase):
    def frame(self, values, freq='D'):
        return pd.DataFrame({'Close':values},index=pd.date_range('2020-01-01',periods=len(values),freq=freq))
    def test_crosses_both_ways_and_no_first_observation_signal(self):
        out=frame_context(self.frame([100]*500+[101,102,98,97,105]),'D',now='2030-01-01')
        self.assertEqual(out['direction'],'UPTREND')
        self.assertEqual([e['code'] for e in out['events']],['S1','B1'])
    def test_unfinished_daily_cannot_reverse_main(self):
        f=self.frame([100]*500+[110,1]); now=f.index[-1]+pd.Timedelta(hours=12)
        out=frame_context(f,'D',now=now)
        self.assertEqual(out['direction'],'UPTREND')
        self.assertEqual(out['close'],110)
        self.assertEqual(out['events'],[])
    def test_forming_hour_and_four_hour_ignored(self):
        for tf,freq,duration in [('1H','h',1),('4H','4h',4)]:
            f=self.frame([100]*500+[110,1],freq)
            before=frame_context(f,tf,now=f.index[-1]+pd.Timedelta(minutes=30))
            self.assertEqual(before['direction'],'UPTREND')
            after=frame_context(f,tf,now=f.index[-1]+pd.Timedelta(hours=duration))
            self.assertEqual(after['direction'],'DOWNTREND')
            self.assertEqual(after['events'][-1]['code'],'S1')
    def test_missing_history_is_unavailable(self):
        out=frame_context(self.frame([100]*499),'4H',now='2030-01-01')
        self.assertEqual(out['direction'],'NEUTRAL')
        self.assertNotIn('500',out['mas'])
        self.assertEqual(out['events'],[])
    def test_equal_close_retains_confirmed_side(self):
        values=[100]*500+[110]
        # Solve next close = next rolling mean exactly.
        values.append(sum(values[-499:])/499)
        out=frame_context(self.frame(values),'D',now='2030-01-01')
        self.assertEqual(out['direction'],'UPTREND')
    def test_all_instruments_use_same_rule_without_channel_fallback(self):
        up=frame_context(self.frame([100]*500+[110]),'4H',now='2030-01-01')
        down=frame_context(self.frame([100]*500+[90]),'4H',now='2030-01-01')
        result=workflow_context({'4H':{'A':{'context':up},'B':{'context':down},'C':{}}})
        self.assertEqual(result['4H']['A']['direction'],'UPTREND')
        self.assertEqual(result['4H']['B']['direction'],'DOWNTREND')
        self.assertNotIn('C',result['4H'])
    def test_daily_reversal_priority_and_no_independent_hourly_stream(self):
        daily={'context':{'events':[{'at':'2026-10-08','code':'S1','price':90}]}}
        h4={'context':{'direction':'UPTREND','events':[{'at':'2026-10-10 04:00','code':'B1','price':101}]}}
        h1={'t':['2026-10-10 03:00','2026-10-10 04:00','2026-10-10 05:00'],
            'c':[99,101,102],'sg':[[1,'B1']],'xm':[[1,'after',50,'up',100]]}
        out=workflow_alerts({'D':{'A':daily},'4H':{'A':h4},'1H':{'A':h1}},now='2026-10-11')
        self.assertEqual([e[1] for e in out['workflow_ev']],['D','4H'])
        self.assertEqual(out['linked_entries']['A'][0]['at'],'2026-10-10 05:00')
        self.assertEqual(out['linked_entries']['A'][0]['kind'],'cross')
    def test_current_hour_cannot_be_a_confirmed_entry(self):
        h1={'t':['2026-10-10 04:00','2026-10-10 05:00'],'c':[101,102],
            'xm':[[0,'after',50,'up',100]]}
        out=workflow_alerts({'4H':{'A':{'context':{'direction':'UPTREND'}}},'1H':{'A':h1}},now='2026-10-10 05:30')
        self.assertEqual(out['linked_entries'],{})
    def test_daily_analytic_levels_do_not_read_future_ribbon_points(self):
        from chart_feed import cross_marks
        daily={'t':['2026-10-01','2026-10-02','2026-10-03'],
               'c':[100,100,100],'h':[102,102,102],'l':[98,98,98],
               'p':[500],'mi':[0,2],'m':[[100,110]],'am':[[100,100,110]]}
        hourly={'t':['2026-10-03 01:00','2026-10-03 02:00','2026-10-03 03:00'],
                'c':[99,101,102],'h':[99.5,101.5,102.5],'l':[98.5,100.5,101.5]}
        before=cross_marks(hourly,daily,1)
        daily['m'][0][-1]=5000
        after=cross_marks(hourly,daily,1)
        self.assertEqual(before,after)
        self.assertTrue(any(e['kind']=='after' and e['v']==100 for e in after))

if __name__=='__main__':unittest.main()
