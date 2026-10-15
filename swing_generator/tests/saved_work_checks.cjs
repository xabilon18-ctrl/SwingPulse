const assert=require('node:assert/strict');
const fs=require('node:fs');
module.exports=async function checkSavedWork(page, screenshots) {
  const full=page.locator('#chartFull');
  await full.locator('[data-freshness-name] summary').click();
  const detail=full.locator('.reel-freshness-detail');
  assert.ok((await detail.innerText()).includes('Latest available quote'));
  // Live hourly snapshots may contain a still-forming 4H candle. Verify that
  // the label agrees with the loaded candle instead of assuming a closed bar.
  const candle=await full.locator('[data-freshness-name]').evaluate(box=>({
    tf:box._barTf,at:box._barTime,forming:box._forming,
  }));
  assert.equal(candle.tf,'4H');
  assert.ok(candle.at,'Chart freshness has a candle timestamp');
  const candleLabel=await detail.locator('div > strong').first().innerText();
  if(candle.forming && candle.forming.t===candle.at) {
    assert.match(candleLabel,/^4H candle · (Still forming|Awaiting final update)$/,
      'A provisional candle must not be labelled completed');
  } else {
    assert.equal(candleLabel,'Last completed 4H bar');
  }
  assert.ok((await detail.innerText()).includes('Published chart and signal data'));
  if(screenshots)await page.screenshot({path:`${screenshots}/freshness-v489.png`});
  await full.locator('[data-freshness-name] summary').click();
  await full.locator('[data-act="grid-menu"]').click();
  await page.locator('.reel-grid-menu [data-division="H"]').click();
  await full.locator('[data-act="grid-menu"]').click();
  await full.locator('[data-act="chart-full-close"]').click();
  await page.locator('#savedWorkBtn').click();
  const panel=page.locator('.saved-work-panel');
  const downloadWait=page.waitForEvent('download');
  await panel.locator('[data-work-download]').click();
  const download=await downloadWait;
  const saved=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(saved.format,'SwingPulseBackup');
  assert.equal(saved.data.grids.grids['4H'].division,'H');
  assert.ok(!JSON.stringify(saved).includes('sync-token'));
  await panel.locator('[data-work-close]').click();
  await page.locator('#chartReel [data-act="grid-menu"]').first().click();
  await page.locator('.reel-grid-menu [data-division="Q"]').click();
  await page.locator('#chartReel [data-act="grid-menu"]').first().click();
  await page.locator('#savedWorkBtn').click();
  const getChannels=()=>page.evaluate(()=>localStorage.getItem('sp-channels'));
  const beforeBad=await getChannels();
  await panel.locator('[data-work-file]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{not-json')});
  await page.waitForFunction(()=>document.querySelector('[data-work-message]').textContent.includes('not valid JSON'));
  assert.equal(await getChannels(),beforeBad,'Invalid backup cannot alter saved work');
  await panel.locator('[data-work-file]').setInputFiles({name:'SwingPulse-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await panel.locator('[data-work-preview]').waitFor({state:'visible'});
  assert.ok((await panel.locator('[data-work-counts]').innerText()).includes('drawing'));
  if(screenshots)await page.screenshot({path:`${screenshots}/saved-work-v489.png`});
  await panel.locator('[data-work-restore]').click();
  await page.waitForFunction(()=>document.querySelector('[data-work-message]').textContent.includes('Restored on this device'));
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('sp-chart-prefs')));
  assert.equal(restored.grids['4H'].division,'H');
  assert.ok(restored.grids['4H'].modifiedAt>saved.data.grids.grids['4H'].modifiedAt,'Restored preference beats older copies on other devices');
  assert.deepEqual(JSON.parse(await getChannels()),saved.data.channels);
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('sp-work-backups')).length>=2),'Pre-restore work has a recovery copy');
  await panel.locator('[data-work-close]').click();
};
