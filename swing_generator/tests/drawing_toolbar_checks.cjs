const assert = require('node:assert/strict');

// Exercise real delegated controls and chart handles in a mobile expanded chart.
module.exports = async function checkDrawingToolbar(page, screenshots) {
  const viewport = page.viewportSize();
    await page.locator('#chartFull [data-act="channel"]').click();
    const toolbar=page.locator('#chartFull .reel-toolbar');
    await toolbar.locator('[data-kind="ladder"]').click();
    // Eight divisions on every timeframe (user, 2026-11-03; ten from
    // 2026-10-21): nine lines, 0% up to 100% in 12.5% steps.
    const chartTf=await page.evaluate(()=>localStorage.getItem('swingpulse-chart-tf'));
    const divs=8, dotSteps=3.75;
    assert.equal(await page.locator('#chartFull .reel-draw.is-sel .reel-ladder').count(),divs+1,`A new ${chartTf} ladder draws ${divs+1} lines`);
    // No % labels when placed (user, 2026-11-01); the % button turns them on.
    assert.equal(await page.locator('#chartFull .reel-draw.is-sel .reel-ladder-lbl').count(),0,'…with no % labels by default');
    {
      // The % labels follow the divisions: 0, 12.5, 25 ... 100 on 1H/4H.
      const pctBtn=toolbar.locator('[data-act="draw-labels"]');
      if (!(await pctBtn.isVisible())) await toolbar.locator('.reel-draw-fold').click();
      await pctBtn.click();
      const labels=await page.locator('#chartFull .reel-draw.is-sel .reel-ladder-lbl').allTextContents();
      const want=Array.from({length:divs+1},(_,i)=>(Math.round(i*1000/divs)/10)+'%');
      assert.deepEqual([...labels].sort((a,b)=>parseFloat(a)-parseFloat(b)),want,'ladder labels on '+chartTf+': '+labels.join(' '));
      await pctBtn.click();
      if (!(await toolbar.evaluate(el=>el.classList.contains('is-collapsed')))) await toolbar.locator('.reel-draw-fold').click();
    }
    assert.ok(await toolbar.evaluate(el=>el.classList.contains('is-collapsed')));
    assert.ok(await page.locator('#chartFull').evaluate(el=>el.classList.contains('ch-editing')));
    assert.ok(await page.locator('#chartFull [data-h]').count()>0,'Handles remain while collapsed');
    const saved=()=>page.evaluate(()=>localStorage.getItem('sp-channels'));
    const lock=toolbar.locator('.reel-draw-lock');
    await lock.click();
    assert.equal(await lock.getAttribute('aria-pressed'),'true','Collapsed strip can lock the drawing');
    assert.equal(await page.locator('#chartFull .reel-draw.is-sel [data-h]').count(),0,'Locked drawing has no drag handles');
    assert.ok(await toolbar.evaluate(el=>el.classList.contains('is-collapsed')),'Lock does not expand the panel');
    await toolbar.locator('[data-act="draw-undo"]').click();
    assert.equal(await lock.getAttribute('aria-pressed'),'false','Lock can be undone');
    await toolbar.locator('.reel-draw-fold').click();
    await toolbar.locator('[data-act="draw-redo"]').click();
    assert.equal(await lock.getAttribute('aria-pressed'),'true','Lock can be redone');
    await toolbar.locator('.reel-draw-fold').click();
    await lock.click();
    assert.equal(await lock.getAttribute('aria-pressed'),'false','Collapsed strip can unlock the drawing');
    assert.ok(await page.locator('#chartFull .reel-draw.is-sel [data-h]').count()>0,'Unlock restores drag handles');
    // Duplicate and Delete sit in the bar (2026-10-30), not under More.
    const drawings=()=>page.locator('#chartFull .reel-draw').count();
    const nDraw=await drawings();
    await toolbar.locator('[data-draw-strip] [data-act="draw-dup"]').click();
    assert.equal(await drawings(),nDraw+1,'Duplicate in the bar copies the drawing');
    await toolbar.locator('[data-draw-strip] [data-act="draw-delete"]').click();
    assert.equal(await drawings(),nDraw,'Delete in the bar removes the copy');
    assert.ok(await toolbar.evaluate(el=>el.classList.contains('is-collapsed')),'Duplicate and Delete do not expand the panel');
    if (screenshots) await page.screenshot({path:`${screenshots}/drawing-toolbar-collapsed-v488.png`});
    const collapsedHeight=await toolbar.evaluate(el=>el.getBoundingClientRect().height);
    const unlocked=await saved();
    await toolbar.locator('.reel-draw-fold').click();
    assert.equal(await saved(),unlocked,'Expand does not alter drawings');
    assert.equal(await toolbar.locator('[data-kind="ladder"]').getAttribute('aria-pressed'),'true');
    if (screenshots) await page.screenshot({path:`${screenshots}/drawing-toolbar-expanded-v488.png`});
    const expandedHeight=await toolbar.evaluate(el=>el.getBoundingClientRect().height);
    const palettes=await toolbar.locator('[data-act="channel-add"]').evaluateAll(buttons=>buttons.map(b=>getComputedStyle(b).backgroundColor));
    assert.equal(new Set(palettes).size,2,'Palette uses neutral buttons plus one selected highlight');
    assert.ok(palettes.every(c=>c==='rgb(241, 243, 245)'||c==='rgb(32, 37, 43)'),'Drawing tool palette is monochrome');
    await toolbar.locator('[data-act="draw-more"]').click();
    assert.equal(await toolbar.locator('.reel-draw-more [data-act="draw-dup"], .reel-draw-more [data-act="draw-delete"]').count(),0,'More no longer repeats Duplicate and Delete');
    await toolbar.locator('[data-act="draw-fill-toggle"]').click();
    assert.equal(await toolbar.locator('[data-act="draw-fill-toggle"]').getAttribute('aria-checked'),'true');
    if (screenshots) await page.screenshot({path:`${screenshots}/drawing-toolbar-more-v488.png`});
    await toolbar.locator('[data-act="draw-undo"]').click();
    assert.equal(await toolbar.locator('[data-act="draw-fill-toggle"]').getAttribute('aria-checked'),'false');
    await toolbar.locator('[data-act="draw-redo"]').click();
    assert.equal(await toolbar.locator('[data-act="draw-fill-toggle"]').getAttribute('aria-checked'),'true');
    await toolbar.locator('.reel-draw-fold').click();
    const beforeDrag=await saved();
    const handle=page.locator('#chartFull .reel-ch-grab').last();
    const box=await handle.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2-35,{steps:8});
    await page.mouse.up();
    assert.notEqual(await saved(),beforeDrag,'Collapsed drawing handles can still be dragged');
    await toolbar.locator('[data-act="draw-undo"]').click();
    assert.equal(await saved(),beforeDrag,'Drag can be undone');
    await page.setViewportSize({width:320,height:740});
    await toolbar.locator('.reel-draw-fold').click();
    assert.ok(await toolbar.evaluate(el=>el.getBoundingClientRect().left>=0&&el.getBoundingClientRect().right<=innerWidth),'Panel fits narrow phone');
    // Show on: choose the timeframes the selected drawing appears on.
    if (await toolbar.locator('[data-act="draw-more"]').getAttribute('aria-expanded')!=='true') await toolbar.locator('[data-act="draw-more"]').click();
    const tfBtns=toolbar.locator('[data-act="draw-tfs"]');
    assert.ok(await tfBtns.count()>=3,'Show on lists the chart timeframes');
    const own=toolbar.locator('[data-act="draw-tfs"][data-own="1"]');
    const ownTf=await own.getAttribute('data-tf');
    assert.equal(await own.getAttribute('aria-pressed'),'true','A drawing shows on its own timeframe');
    assert.equal(await toolbar.locator('[data-act="draw-tfs"][aria-pressed="true"]').count(),1,'…and only there by default');
    assert.ok(await own.isDisabled(),'The last timeframe cannot be switched off');
    const other=toolbar.locator(`[data-act="draw-tfs"]:not([data-tf="${ownTf}"])`).first();
    const otherTf=await other.getAttribute('data-tf');
    const ladderOn=tf=>page.evaluate(([tf])=>{const all=JSON.parse(localStorage.getItem('sp-channels')||'{}');
      return Object.values(all).map(per=>(per[tf]||[]).find(d=>d&&d.kind==='ladder')).find(Boolean)||null;},[tf]);
    await other.click();
    const copy=await ladderOn(otherTf), orig=await ladderOn(ownTf);
    assert.ok(copy&&orig&&copy.link&&copy.link===orig.link,`Showing on ${otherTf} copies the drawing there, linked`);
    assert.deepEqual([...orig.tfs].sort(),[ownTf,otherTf].sort(),'It records exactly the chosen timeframes');
    if (screenshots) await page.screenshot({path:`${screenshots}/drawing-show-on-v512.png`});
    await own.click();
    assert.equal(await page.locator('#chartFull .reel-draw.is-sel').count(),0,'Switched off here: not drawn on this chart');
    assert.ok(await ladderOn(ownTf),'…but kept, so it can be switched back on');
    assert.equal(await toolbar.locator('[data-act="draw-tfs"][aria-pressed="true"]').count(),1);
    await own.click();
    assert.equal(await page.locator('#chartFull .reel-draw.is-sel').count(),1,'Switched back on');
    await other.click();
    assert.equal(await ladderOn(otherTf),null,`Only its own chart again: the ${otherTf} copy is removed`);
    assert.ok(!(await ladderOn(ownTf)).link,'…and the drawing is unlinked');
    assert.ok(await toolbar.evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'Show on fits a narrow phone');
    // Channel line weight (2026-10-20): thin (default) / thick / thicker.
    if (await toolbar.evaluate(el=>el.classList.contains('is-collapsed'))) await toolbar.locator('.reel-draw-fold').click();
    await toolbar.locator('[data-kind="channel"]').click();
    if (await toolbar.evaluate(el=>el.classList.contains('is-collapsed'))) await toolbar.locator('.reel-draw-fold').click();
    const channelOn=()=>page.evaluate(([tf])=>{const all=JSON.parse(localStorage.getItem('sp-channels')||'{}');
      return Object.values(all).map(per=>(per[tf]||[]).filter(d=>d&&d.kind==='channel').pop()).find(Boolean)||null;},[ownTf]);
    const weights=toolbar.locator('[data-act="draw-weight"]');
    assert.equal(await weights.count(),3,'A channel offers three line weights');
    assert.equal(await toolbar.locator('[data-act="draw-weight"][data-v="1"]').getAttribute('aria-pressed'),'true','Thin is the default');
    const edgeW=()=>page.locator('#chartFull .reel-draw.is-sel .reel-ch-edge').first().evaluate(el=>parseFloat(getComputedStyle(el).strokeWidth));
    const thin=await edgeW();
    await toolbar.locator('[data-act="draw-weight"][data-v="3"]').click();
    assert.equal((await channelOn()).strokeWeight,3,'Thick is saved on the channel');
    assert.ok(await edgeW()>thin*2,'Thick draws the channel edges heavier');
    await toolbar.locator('[data-act="draw-weight"][data-v="2"]').click();
    const thick=await edgeW();
    assert.ok(thick>thin&&(await channelOn()).strokeWeight===2,'Medium sits between');
    await toolbar.locator('[data-act="draw-weight"][data-v="1"]').click();
    assert.equal((await channelOn()).strokeWeight,1,'Thin is an explicit saved choice');
    assert.equal(await edgeW(),thin,'…and draws as before');
    assert.ok(await toolbar.evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'Weight buttons fit a narrow phone');
    // Channel ten divisions (2026-10-21): a switch, off by default.
    const divSw=toolbar.locator('[data-act="draw-div"]');
    const divLines=()=>page.locator('#chartFull .reel-draw.is-sel .reel-ch-div').count();
    assert.equal(await divSw.getAttribute('aria-checked'),'false','Divisions start off');
    assert.equal(await divLines(),0,'…and draw nothing');
    await divSw.click();
    assert.equal((await channelOn()).div,true,'Divisions on is saved on the channel');
    assert.equal(await divLines(),8,'Ten divisions: eight dotted lines between the edges and the midline');
    assert.equal(await page.locator('#chartFull .reel-draw.is-sel .reel-ladder-lbl').count(),0,'…with no % labels on the channel');
    assert.equal(await toolbar.locator('[data-act="draw-div"]').getAttribute('aria-checked'),'true');
    await toolbar.locator('[data-act="draw-div"]').click();
    assert.ok(!('div' in (await channelOn())),'Off stores no field');
    assert.equal(await divLines(),0,'…and the divisions are gone');
    // SELECTION (user, 2026-11-01): the selected drawing's DOTS turn solid
    // blue (hollow and ungrabbable when locked); the blue glow is a ladder-only
    // option, off by default. The selected drawing is painted over the others,
    // a tap on empty chart clears it and a tap on one of its lines picks it
    // again. The ladder is still on the chart.
    if (!(await toolbar.evaluate(el=>el.classList.contains('is-collapsed')))) await toolbar.locator('.reel-draw-fold').click();
    const sel=()=>page.locator('#chartFull .reel-draw.is-sel');
    // The glow is the ladder's own .reel-ladder-glow band (2026-11-03); the
    // tap lines (.reel-ch-hit) stay transparent on every drawing.
    const visibleStroke=el=>{const c=getComputedStyle(el);
      return c.stroke!=='none'&&c.stroke!=='transparent'&&c.stroke!=='rgba(0, 0, 0, 0)'&&+c.strokeOpacity>0;};
    const halo=async()=>{const g=sel().locator('.reel-ladder-glow');
      return (await g.count())>0&&await g.first().evaluate(visibleStroke);};
    assert.ok(await page.locator('#chartFull .reel-draw').count()>=2,'Ladder and channel are both on the chart');
    const dotFill=()=>sel().locator('.reel-ch-h').first().evaluate(el=>getComputedStyle(el).fill);
    assert.equal(await dotFill(),'rgb(37, 99, 235)','The selected drawing\'s dots are solid blue');
    assert.ok(!(await halo()),'…and a channel has no glow');
    assert.ok(await page.locator('#chartFull .reel-draw').last().evaluate(el=>el.classList.contains('is-sel')),'…and is painted over the other drawings');
    await toolbar.locator('.reel-draw-lock').click();
    assert.equal(await sel().locator('[data-h]').count(),0,'Locked: nothing to grab');
    assert.ok(await sel().locator('.reel-ch-h.is-locked').count()>0,'…but its dots still show it is selected');
    assert.equal(await dotFill(),'rgb(255, 255, 255)','…hollow, as a locked drawing');
    await toolbar.locator('.reel-draw-lock').click();
    const chDi=await sel().locator('.reel-ch-hit').first().getAttribute('data-di');
    // The chart repaints on every gesture, replacing its SVG: re-measure until
    // the element is laid out again rather than reading a box mid-repaint.
    const boxOf=async loc=>{for(let i=0;i<40;i++){const b=await loc.boundingBox({timeout:1000}).catch(()=>null);if(b)return b;await page.waitForTimeout(50);}return null;};
    // A point on the chart where elementFromPoint hits what `want` asks for.
    const spot=want=>page.evaluate(([want,di])=>{
      const svg=document.querySelector('#chartFullHost svg'); const r=svg.getBoundingClientRect();
      for(let y=r.top+r.height*.15;y<r.top+r.height*.7;y+=5) for(let x=r.left+r.width*.2;x<r.left+r.width*.75;x+=5){
        const el=document.elementFromPoint(x,y); if(!el||!svg.contains(el)) continue;
        const h=el.closest('[data-h]'), d=el.closest('[data-di]');
        if(want==='empty'&&!h&&!d) return {x,y};
        if(want==='line'&&!h&&d&&d.getAttribute('data-di')===di) return {x,y};
        if(want==='other'&&!h&&d&&d.getAttribute('data-di')!==di) return {x,y};
      } return null;},[want,chDi]);
    const empty=await spot('empty');
    assert.ok(empty,'Found empty chart to tap');
    await page.mouse.click(empty.x,empty.y);
    assert.equal(await sel().count(),0,'A tap on empty chart clears the selection');
    assert.ok(await page.locator('#chartFull').evaluate(el=>el.classList.contains('ch-editing')),'…and Draw mode stays open');
    assert.ok(await toolbar.locator('[data-draw-strip] [data-act="draw-delete"]').isDisabled(),'…with nothing for Delete to act on');
    const line=await spot('line');
    assert.ok(line,'Found a channel line to tap');
    await page.mouse.click(line.x,line.y);
    assert.equal(await sel().count(),1,'A tap on the channel selects it again');
    assert.equal(await sel().locator('.reel-ch-hit').first().getAttribute('data-di'),chDi,'…the channel, not the ladder');
    // The ladder was drawn FIRST; selected, it must still come out on top.
    const ladderPt=await spot('other');
    assert.ok(ladderPt,'Found a ladder line to tap');
    await page.mouse.click(ladderPt.x,ladderPt.y);
    assert.notEqual(await sel().locator('.reel-ch-hit').first().getAttribute('data-di'),chDi,'A tap on the ladder selects the ladder');
    assert.ok(await page.locator('#chartFull .reel-draw').last().evaluate(el=>el.classList.contains('is-sel')),'The selected ladder is painted over the channel');
    // Ladder resize dot on the 40% line (user, 2026-11-01), not 30%.
    {
      const lad=await ladderOn(ownTf);
      const cy=+(await sel().locator('.reel-ch-h[data-h="l4"]').getAttribute('cy'));
      const want=await page.evaluate(([p1,p4,ds])=>document.querySelector('#chartFullHost')._reelCtx.sc.y(p1+ds*(p4-p1)/3),[lad.p1,lad.p4,dotSteps]);
      assert.ok(Math.abs(cy-want)<0.6,`Ladder resize dot sits on the 40% line (${cy} vs ${want})`);
      const g=await boxOf(sel().locator('.reel-ch-grab[data-h="l4"]'));
      await page.mouse.move(g.x+g.width/2,g.y+g.height/2); await page.mouse.down();
      await page.mouse.move(g.x+g.width/2,g.y+g.height/2-30,{steps:6}); await page.mouse.up();
      const moved=await ladderOn(ownTf);
      const cy2=+(await sel().locator('.reel-ch-h[data-h="l4"]').getAttribute('cy'));
      const want2=await page.evaluate(([p1,p4,ds])=>document.querySelector('#chartFullHost')._reelCtx.sc.y(p1+ds*(p4-p1)/3),[moved.p1,moved.p4,dotSteps]);
      assert.ok(moved.p4!==lad.p4&&moved.p1===lad.p1,'Dragging the 40% dot resizes the ladder; 0% stays');
      assert.ok(Math.abs(cy2-want2)<0.6,'…and the dot stays on the 40% line');
      // Glow: off by default, a switch for the ladder only.
      assert.ok(!(await halo()),'A ladder has no glow by default');
      await toolbar.locator('.reel-draw-fold').click();
      const glowBtn=toolbar.locator('[data-act="draw-glow"]');
      assert.equal(await glowBtn.getAttribute('aria-pressed'),'false');
      await glowBtn.click();
      assert.ok(await halo(),'Glow on shows the blue glow');
      assert.equal((await ladderOn(ownTf)).glow,true,'…and is saved on the ladder');
      // Glow colour (user, 2026-11-01).
      const haloStroke=()=>sel().locator('.reel-ladder-glow').first().evaluate(el=>getComputedStyle(el).stroke);
      assert.equal(await haloStroke(),'rgb(37, 99, 235)','Glow starts blue');
      // Half the tap line's thickness (user, 2026-11-03), and the tap line
      // itself stays invisible and keeps its full width.
      const widths=await sel().evaluate(g=>[...['.reel-ladder-glow','.reel-ch-hit']].map(q=>parseFloat(getComputedStyle(g.querySelector(q)).strokeWidth)));
      assert.equal(widths[0]*2,widths[1],'The glow is half as thick as the tap line: '+widths);
      assert.ok(!(await sel().locator('.reel-ch-hit').first().evaluate(visibleStroke)),'…and the tap line stays invisible');
      await toolbar.locator('[data-act="draw-glow-color"][data-color="#22c55e"]').click();
      assert.equal(await haloStroke(),'rgb(34, 197, 94)','Picking green turns the glow green');
      assert.equal((await ladderOn(ownTf)).glowColor,'#22c55e','…and saves the colour');
      // It STAYS when the ladder is not selected (user, 2026-11-03: "must
      // stay if turned on"): tap empty chart, the glow is still drawn; tap a
      // ladder line to pick it again.
      const ladDi=await sel().locator('.reel-ch-hit').first().getAttribute('data-di');
      const off=await spot('empty');
      assert.ok(off,'Found empty chart to tap');
      await page.mouse.click(off.x,off.y);
      assert.equal(await sel().count(),0,'Nothing is selected');
      assert.ok(await page.locator(`#chartFull .reel-draw:not(.is-sel) .reel-ladder-glow`).count()>0,'…and the ladder still glows');
      const onLad=await page.evaluate(di=>{const svg=document.querySelector('#chartFullHost svg'),r=svg.getBoundingClientRect();
        for(let y=r.top+r.height*.1;y<r.top+r.height*.9;y+=3){const x=r.left+r.width*.5,e=document.elementFromPoint(x,y);
          const d=e&&svg.contains(e)&&!e.closest('[data-h]')&&e.closest('[data-di]');if(d&&d.getAttribute('data-di')===di)return {x,y};}return null;},ladDi);
      assert.ok(onLad,'Found a ladder line to tap');
      await page.mouse.click(onLad.x,onLad.y);
      assert.equal(await sel().locator('.reel-ch-hit').first().getAttribute('data-di'),ladDi,'The ladder is selected again');
      await toolbar.locator('[data-act="draw-glow"]').click();
      assert.ok(!(await halo()),'Glow off removes it');
      assert.ok(!('glow' in (await ladderOn(ownTf))),'…and stores nothing');
      assert.equal(await toolbar.locator('[data-act="draw-glow-color"]').count(),0,'Glow colours hide while the glow is off');
      // "0" frames the price scale from zero (user, 2026-11-01).
      const lo=()=>page.evaluate(()=>document.querySelector('#chartFullHost')._reelCtx.sc.lo);
      const zeroBtn=()=>toolbar.locator('[data-act="chart-zero"]');
      const loBefore=await lo();
      await zeroBtn().click();
      assert.ok(await lo()<=0,'"0" brings zero onto the price scale');
      assert.equal(await zeroBtn().getAttribute('aria-pressed'),'true');
      // Zero holds the ladder: dragged far down, its bottom line stops ON 0.
      const mv=await boxOf(sel().locator('.reel-ch-grab[data-h="m"]'));
      const plot=await boxOf(page.locator('#chartFullHost'));
      await page.mouse.move(mv.x+mv.width/2,mv.y+mv.height/2); await page.mouse.down();
      await page.mouse.move(mv.x+mv.width/2,plot.y+plot.height-5,{steps:12}); await page.mouse.up();
      const held=await ladderOn(ownTf);
      assert.equal(held.p1,0,`Moved past zero, the 0% line stops on 0 (p1 ${held.p1})`);
      // ...a block added below lifts the ladder so the NEW block's bottom line
      // sits on 0, and a later drag down stops it there too.
      await toolbar.locator('[data-act="draw-stack"][data-dir="down"][data-d="1"]').click();
      const st=await ladderOn(ownTf), stStep=(st.p4-st.p1)/3;
      assert.ok(st.down===1&&Math.abs(st.p1-10*stStep)<1e-9,`A block added below lifts the ladder onto 0 (${st.p1-10*stStep})`);
      await toolbar.locator('.reel-draw-fold').click();          // the open bar covers the lower chart
      // The added block lifts the ladder, so its move handle (the 50% line)
      // can now sit above the price scale and is, correctly, not drawn: on
      // live ALAB 4H (2026-11-03) it was at ~708 under a 519 top. Widen the
      // price window with the axis grip until the handle is on screen,
      // instead of assuming the data leaves room for it.
      let widened=false;
      for(let i=0;i<8&&!(await sel().locator('.reel-ch-grab[data-h="m"]').count());i++){
        widened=true;
        const yg=await boxOf(page.locator('#chartFull .reel-ygrip'));
        const gx=yg.x+yg.width/2, gy=yg.y+yg.height*.3;
        await page.mouse.move(gx,gy); await page.mouse.down();
        await page.mouse.move(gx,gy+yg.height*.25,{steps:8}); await page.mouse.up();
      }
      const mv2=await boxOf(sel().locator('.reel-ch-grab[data-h="m"]'));
      assert.ok(mv2,'The ladder\'s move handle is on screen to drag');
      await page.mouse.move(mv2.x+mv2.width/2,mv2.y+mv2.height/2); await page.mouse.down();
      await page.mouse.move(mv2.x+mv2.width/2,mv2.y+mv2.height/2+60,{steps:8}); await page.mouse.up();
      const st2=await ladderOn(ownTf), step2=(st2.p4-st2.p1)/3;
      assert.ok(Math.abs(st2.p1-10*step2)<1e-9,`Dragged down, the bottom block still stops on 0 (${st2.p1-10*step2})`);
      await toolbar.locator('.reel-draw-fold').click();
      // A manual price zoom replaces the zero window (reel.lockY), so put "0"
      // back on before checking that it turns off again.
      if (widened && await zeroBtn().getAttribute('aria-pressed')!=='true') await zeroBtn().click();
      await zeroBtn().click();
      assert.equal(await zeroBtn().getAttribute('aria-pressed'),'false','"0" again goes back to the normal scale');
      assert.ok(await lo()>0||loBefore<=0,'…and zero leaves the scale');
      await toolbar.locator('.reel-draw-fold').click();
    }
    const back=await spot('line');
    await page.mouse.click(back.x,back.y);
    assert.equal(await sel().locator('.reel-ch-hit').first().getAttribute('data-di'),chDi,'…and the channel can be picked again');
    // CHANNEL ENDS (user, 2026-11-01): both end handles drag, and each moves its own end.
    for (const [h,k] of [['a','p1'],['b','p2']]) {
      const before=(await channelOn())[k];
      const g=await boxOf(sel().locator(`.reel-ch-grab[data-h="${h}"]`));
      assert.ok(g,`End handle ${h} is drawn`);
      await page.mouse.move(g.x+g.width/2,g.y+g.height/2);
      await page.mouse.down();
      await page.mouse.move(g.x+g.width/2,g.y+g.height/2-40,{steps:8});
      await page.mouse.up();
      assert.notEqual((await channelOn())[k],before,`Dragging end ${h} straight up moves that end`);
    }
    // SHORT CHANNEL (2026-11-03): with both ends close together on screen the
    // move handle sat halfway between them, on top of both, and took the touch
    // meant for an end (found on live ALAB 4H). Each end must be on top where
    // it is drawn.
    {
      const ga0=await boxOf(sel().locator('.reel-ch-grab[data-h="a"]'));
      const gb0=await boxOf(sel().locator('.reel-ch-grab[data-h="b"]'));
      const mid=b=>({x:b.x+b.width/2,y:b.y+b.height/2}), ca=mid(ga0), cb=mid(gb0);
      await page.mouse.move(cb.x,cb.y); await page.mouse.down();
      await page.mouse.move(ca.x+18,ca.y,{steps:10}); await page.mouse.up();
      for (const h of ['a','b']) {
        const g=await boxOf(sel().locator(`.reel-ch-grab[data-h="${h}"]`));
        assert.ok(g,`Short channel: end handle ${h} is drawn`);
        const top=await page.evaluate(([x,y])=>{const e=document.elementFromPoint(x,y);return e&&e.dataset?e.dataset.h||'':'none';},[g.x+g.width/2,g.y+g.height/2]);
        assert.equal(top,h,`Short channel: end handle ${h} can be touched where it is drawn (got "${top}")`);
      }
    }
    // Both ends panned off the panel: the end handles stay on screen, on the
    // midline, and dragging one still turns the channel. The channel is first
    // made FLAT at the middle of the price window, on the right of the view;
    // a pan keeps the price window, so the midline is certain to stay in view
    // whatever the fixture's prices are (CI drew a steep one 2,000px off).
    const drag=async(from,to)=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});await page.mouse.up();};
    const centre=b=>({x:b.x+b.width/2,y:b.y+b.height/2});
    const geo=await page.evaluate(()=>{const h=document.querySelector('#chartFullHost'),c=h._reelCtx,svg=h.querySelector('svg'),m=svg.getScreenCTM();
      const yv=c.sc.y((c.sc.lo+c.sc.hi)/2),W=c.L.x1-c.L.x0;
      const scr=(x,y)=>{const p=svg.createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform(m);return {x:q.x,y:q.y};};
      return {a:scr(c.L.x0+W*.68,yv),b:scr(c.L.x0+W*.9,yv)};});
    await drag(centre(await boxOf(sel().locator('.reel-ch-grab[data-h="a"]'))),geo.a);
    await drag(centre(await boxOf(sel().locator('.reel-ch-grab[data-h="b"]'))),geo.b);
    const anchors=await channelOn();
    const start=await page.evaluate(()=>{const svg=document.querySelector('#chartFullHost svg'),r=svg.getBoundingClientRect();
      for(let y=r.top+r.height*.2;y<r.top+r.height*.7;y+=5){const x=r.left+r.width*.04,e=document.elementFromPoint(x,y);
        if(e&&svg.contains(e)&&!e.closest('[data-h]'))return {x,y,w:r.width,right:r.right};}return null;});
    assert.ok(start,'Found a place to start a pan');
    const panDx=start.w*.55;
    await drag(start,{x:start.x+panDx,y:start.y});
    // The chart follows the finger 1:1, so each end is now panDx further right.
    assert.ok(geo.a.x+panDx>start.right&&geo.b.x+panDx>start.right,'Panned past both ends');
    assert.ok(await page.locator('#chartFull .reel-ch-note').count()===0,'No "handles are outside this range" note');
    const svgBox=await boxOf(page.locator('#chartFullHost'));
    for (const h of ['a','b']) {
      const grab=sel().locator(`.reel-ch-grab[data-h="${h}"]`);
      assert.equal(await grab.count(),1,`Panned past both ends, end handle ${h} is still drawn`);
      const g=await boxOf(grab);
      assert.ok(g&&g.x+g.width/2>=svgBox.x&&g.x+g.width/2<=svgBox.x+svgBox.width,`…and end handle ${h} is on screen`);
    }
    const ga=await boxOf(sel().locator('.reel-ch-grab[data-h="a"]'));
    const onTop=await page.evaluate(([x,y])=>{const e=document.elementFromPoint(x,y);return e?(e.getAttribute('class')||'')+'|'+(e.dataset&&e.dataset.h||''):'none';},[ga.x+ga.width/2,ga.y+ga.height/2]);
    assert.equal(onTop,'reel-ch-grab|a',`End handle a can be touched where it is drawn (${JSON.stringify(ga)})`);
    await page.mouse.move(ga.x+ga.width/2,ga.y+ga.height/2); await page.mouse.down();
    await page.mouse.move(ga.x+ga.width/2,ga.y+ga.height/2-40,{steps:8}); await page.mouse.up();
    const turned=await channelOn();
    assert.ok(turned.p1!==anchors.p1&&turned.t2===anchors.t2&&turned.p2===anchors.p2,'The edge handle re-anchors its end; the other end stays put: '+JSON.stringify({anchors,turned}));
    await toolbar.locator('[data-act="draw-done"]').click();
    assert.equal(await page.locator('#chartFull').evaluate(el=>el.classList.contains('ch-editing')),false);
    assert.equal(await toolbar.isVisible(),false);
    await page.setViewportSize(viewport);
    return {collapsedHeight, expandedHeight};
};
