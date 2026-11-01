const assert = require('node:assert/strict');

// Exercise real delegated controls and chart handles in a mobile expanded chart.
module.exports = async function checkDrawingToolbar(page, screenshots) {
  const viewport = page.viewportSize();
    await page.locator('#chartFull [data-act="channel"]').click();
    const toolbar=page.locator('#chartFull .reel-toolbar');
    await toolbar.locator('[data-kind="ladder"]').click();
    // Ten divisions, not nine (2026-10-21): eleven lines, 0% up to 100%.
    assert.equal(await page.locator('#chartFull .reel-draw.is-sel .reel-ladder').count(),11,'A new ladder draws eleven lines');
    // No % labels when placed (user, 2026-11-01); the % button turns them on.
    assert.equal(await page.locator('#chartFull .reel-draw.is-sel .reel-ladder-lbl').count(),0,'…with no % labels by default');
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
    // SELECTION (user, 2026-11-01): the selected drawing shows a halo, locked
    // or not, is painted over the others, a tap on empty chart clears it and a
    // tap on one of its lines picks it again. The ladder is still on the chart.
    if (!(await toolbar.evaluate(el=>el.classList.contains('is-collapsed')))) await toolbar.locator('.reel-draw-fold').click();
    const sel=()=>page.locator('#chartFull .reel-draw.is-sel');
    const halo=()=>sel().locator('.reel-ch-hit').first().evaluate(el=>{const c=getComputedStyle(el);
      return c.stroke!=='none'&&c.stroke!=='transparent'&&c.stroke!=='rgba(0, 0, 0, 0)'&&+c.strokeOpacity>0;});
    assert.ok(await page.locator('#chartFull .reel-draw').count()>=2,'Ladder and channel are both on the chart');
    assert.ok(await halo(),'The selected drawing shows a halo');
    assert.ok(await page.locator('#chartFull .reel-draw').last().evaluate(el=>el.classList.contains('is-sel')),'…and is painted over the other drawings');
    await toolbar.locator('.reel-draw-lock').click();
    assert.equal(await sel().locator('[data-h]').count(),0,'Locked: no handles');
    assert.ok(await halo(),'…but the halo still shows it is selected');
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
    // Zoomed in until both ends are off the panel, the end handles stay on
    // screen, on the midline, and dragging one still turns the channel.
    const anchors=await channelOn();
    for (let i=0;i<3;i++) {
      const tg=await boxOf(page.locator('#chartFullHost [data-tgrip]'));
      assert.ok(tg,'Time scale grip is on screen');
      await page.mouse.move(tg.x+tg.width*.8,tg.y+tg.height/2); await page.mouse.down();
      await page.mouse.move(tg.x+tg.width*.8-300,tg.y+tg.height/2,{steps:10}); await page.mouse.up();
    }
    const firstShown=await page.evaluate(()=>document.querySelector('#chartFullHost')._reelCtx.b.t[0]);
    assert.ok(firstShown>anchors.t2,`Zoomed in past both ends (window starts ${firstShown})`);
    assert.ok(await page.locator('#chartFull .reel-ch-note').count()===0,'No "handles are outside this range" note');
    const svgBox=await boxOf(page.locator('#chartFullHost'));
    for (const h of ['a','b']) {
      const grab=sel().locator(`.reel-ch-grab[data-h="${h}"]`);
      assert.equal(await grab.count(),1,`Zoomed past both ends, end handle ${h} is still drawn`);
      const g=await boxOf(grab);
      assert.ok(g&&g.x+g.width/2>=svgBox.x&&g.x+g.width/2<=svgBox.x+svgBox.width,`…and end handle ${h} is on screen`);
    }
    const ga=await boxOf(sel().locator('.reel-ch-grab[data-h="a"]'));
    await page.mouse.move(ga.x+ga.width/2,ga.y+ga.height/2); await page.mouse.down();
    await page.mouse.move(ga.x+ga.width/2,ga.y+ga.height/2-40,{steps:8}); await page.mouse.up();
    const turned=await channelOn();
    assert.ok(turned.p1!==anchors.p1&&turned.t2===anchors.t2&&turned.p2===anchors.p2,'The edge handle re-anchors its end; the other end stays put');
    await toolbar.locator('[data-act="draw-done"]').click();
    assert.equal(await page.locator('#chartFull').evaluate(el=>el.classList.contains('ch-editing')),false);
    assert.equal(await toolbar.isVisible(),false);
    await page.setViewportSize(viewport);
    return {collapsedHeight, expandedHeight};
};
