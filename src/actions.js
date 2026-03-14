/**
 * actions.js — Core automation actions for Canvas LMS
 *
 * Each function accepts a Puppeteer Page instance and options.
 * All actions use retry() + humanDelay() for reliability.
 */
'use strict';

require('dotenv').config();

/**
 * login_canvas — Authenticate to Canvas with SSO
 * @param {import('puppeteer').Page} page
 * @param {Object} opts
 * @returns {Promise<Object>}
 */
async function login_canvas(page, opts = {}) {
  const { retry, humanDelay, log } = require('./utils');

  log('Running: login_canvas', opts);

  return retry(async () => {
    await humanDelay(500, 1500);
    try {
      const BASE_URL = process.env.CANVAS_URL;
    await page.goto(`${BASE_URL}/login/canvas`, { waitUntil: 'networkidle2' });
    // If redirected to SSO (Google/Okta/Shibboleth), handle there
    if (!page.url().includes('/login/canvas')) {
      await page.waitForSelector('input[type="email"], input[type="text"]', { timeout: 15000 });
      await page.type('input[type="email"], input[type="text"]', process.env.CANVAS_USERNAME);
      await page.keyboard.press('Enter');
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.type('input[type="password"]', process.env.CANVAS_PASSWORD);
      await page.keyboard.press('Enter');
    } else {
      await page.waitForSelector('#pseudonym_session_unique_id', { timeout: 15000 });
      await page.type('#pseudonym_session_unique_id', process.env.CANVAS_USERNAME);
      await page.type('#pseudonym_session_password', process.env.CANVAS_PASSWORD);
      await page.click('button[type="submit"], .ic-Button--login');
    }
    // Handle MFA (Duo)
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    const mfaCode = await page.$('#otp_attempt');
    if (mfaCode) {
      const code = generateTOTP(process.env.MFA_SECRET);
      await mfaCode.type(code);
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    }
    await page.waitForSelector('#header, #student-view-toggle, .ic-app-header', { timeout: 20000 });
    return { status: 'logged_in' };
    } catch (err) {
      await page.screenshot({ path: `error-login_canvas-${Date.now()}.png` }).catch(() => {});
      throw err;
    }
  }, { attempts: 3, delay: 2000 });
}

/**
 * create_course — Create and configure new courses
 * @param {import('puppeteer').Page} page
 * @param {Object} opts
 * @returns {Promise<Object>}
 */
async function create_course(page, opts = {}) {
  const { retry, humanDelay, log } = require('./utils');

  log('Running: create_course', opts);

  return retry(async () => {
    await humanDelay(500, 1500);
    try {
      // TODO: Replace with actual Canvas LMS selectors
    // await page.goto(`${process.env.CANVAS_URL}/path/to/create-course`);
    // await page.waitForSelector('.main-content, #content, [data-testid="loaded"]', { timeout: 15000 });
    const result = await page.evaluate(() => {
      return { status: 'ok', data: null };
    });
    log('create_course complete', result);
    return result;
    } catch (err) {
      await page.screenshot({ path: `error-create_course-${Date.now()}.png` }).catch(() => {});
      throw err;
    }
  }, { attempts: 3, delay: 2000 });
}

/**
 * bulk_enroll — Bulk enroll students across multiple courses
 * @param {import('puppeteer').Page} page
 * @param {Object} opts
 * @returns {Promise<Object>}
 */
async function bulk_enroll(page, opts = {}) {
  const { retry, humanDelay, log } = require('./utils');

  log('Running: bulk_enroll', opts);

  return retry(async () => {
    await humanDelay(500, 1500);
    try {
      const BASE_URL = process.env.CANVAS_URL;
    await page.goto(`${BASE_URL}/courses/${opts.courseId}/users`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.btn-primary[href*="enroll"], .ic-Action-header a, button.btn-primary', { timeout: 15000 });
    await page.click('.btn-primary[href*="enroll"], button[title*="Add People"]');
    await page.waitForSelector('#user_list, textarea, input[type="text"]', { timeout: 10000 });
    const userList = opts.emails?.join('\n') || opts.userIds?.join('\n') || '';
    await page.type('#user_list, textarea', userList);
    await page.click('button[type="submit"], .ic-Button--primary[type="submit"]');
    await page.waitForSelector('.ic-flash-success, .success', { timeout: 15000 }).catch(() => {});
    return { status: 'ok', enrolledCount: opts.emails?.length || opts.userIds?.length };
    } catch (err) {
      await page.screenshot({ path: `error-bulk_enroll-${Date.now()}.png` }).catch(() => {});
      throw err;
    }
  }, { attempts: 3, delay: 2000 });
}

/**
 * submit_grades — Submit grades with override capabilities
 * @param {import('puppeteer').Page} page
 * @param {Object} opts
 * @returns {Promise<Object>}
 */
async function submit_grades(page, opts = {}) {
  const { retry, humanDelay, log } = require('./utils');

  log('Running: submit_grades', opts);

  return retry(async () => {
    await humanDelay(500, 1500);
    try {
      const BASE_URL = process.env.CANVAS_URL;
    const { courseId, assignmentId, studentId, grade } = opts;
    if (assignmentId && studentId) {
      // SpeedGrader approach (direct grade input)
      await page.goto(`${BASE_URL}/courses/${courseId}/gradebook/speed_grader?assignment_id=${assignmentId}&student_id=${studentId}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#grading-box-extended, input[name="grade"]', { timeout: 15000 });
      const gradeInput = await page.$('#grading-box-extended, input[name="grade"]');
      if (gradeInput) {
        await gradeInput.click({ clickCount: 3 });
        await gradeInput.type(String(grade));
        await page.keyboard.press('Enter');
        await humanDelay(500, 1000);
      }
    } else {
      // Gradebook bulk entry
      await page.goto(`${BASE_URL}/courses/${courseId}/gradebook`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.gradebook-cell, [data-testid="gradeInput"]', { timeout: 20000 });
      for (const entry of (opts.grades || [])) {
        const cell = await page.$(`[data-student="${entry.studentId}"][data-assignment="${entry.assignmentId}"] .grade`);
        if (cell) {
          await cell.dblclick();
          await page.waitForSelector('input.grade, [data-testid="gradeInput"]', { timeout: 3000 });
          const input = await page.$('input.grade, [data-testid="gradeInput"]');
          if (input) { await input.click({clickCount:3}); await input.type(String(entry.grade)); await input.press('Tab'); }
        }
      }
    }
    return { status: 'ok' };
    } catch (err) {
      await page.screenshot({ path: `error-submit_grades-${Date.now()}.png` }).catch(() => {});
      throw err;
    }
  }, { attempts: 3, delay: 2000 });
}

/**
 * export_analytics — Download learning analytics data
 * @param {import('puppeteer').Page} page
 * @param {Object} opts
 * @returns {Promise<Object>}
 */
async function export_analytics(page, opts = {}) {
  const { retry, humanDelay, log } = require('./utils');

  log('Running: export_analytics', opts);

  return retry(async () => {
    await humanDelay(500, 1500);
    try {
      // TODO: Replace with actual Canvas LMS selectors
    // await page.goto(`${process.env.CANVAS_URL}/path/to/export-analytics`);
    // await page.waitForSelector('.main-content, #content, [data-testid="loaded"]', { timeout: 15000 });
    const result = await page.evaluate(() => {
      return { status: 'ok', data: null };
    });
    log('export_analytics complete', result);
    return result;
    } catch (err) {
      await page.screenshot({ path: `error-export_analytics-${Date.now()}.png` }).catch(() => {});
      throw err;
    }
  }, { attempts: 3, delay: 2000 });
}

module.exports = {
  login_canvas,
  create_course,
  bulk_enroll,
  submit_grades,
  export_analytics,
};
