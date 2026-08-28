/**
 * dpdFeedback.js
 * =================
 * Handles Digital Pāḷi Dictionary (DPD) feedback template retrieval and link restoration.
 * Adapted from ref/tipitakapali.org/web/handleClick_dev.js
 */

export const reDPDLinks = [
  ['https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform', 'L#0@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSdAL2PzavyrtXgGmtNrZAMyh3hV6g3fU0chxhWFxunQEZtH0g/viewform', 'L#1@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform', 'L#2@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSfKUBx-icfRCWmhHqUwzX60BVQE21s_NERNfU2VvbjEfE371A/viewform', 'L#3@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform', 'L#4@'],
];

export const regExpFeedbackDPDId = /#z3@(.*?)_fb@/g;

// Fallback template (with latest CST/DPD version date 2026-03-03)
export let dpd_feedback_s = `<p>ID <b>#tpo_id@ #tpo_word@</b></p><p>Digital Pāḷi Dictionary is a work in progress, made available for testing and feedback purposes.</p><p><a class="dpd-link" href="https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform?usp=pp_url&entry.1433863141=Tipitakapali.org+2026-03-03" target="_blank">Add a missing word</a><span>. Please use this </span><a class="dpd-link" href="https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform?usp=pp_url&entry.1433863141=Tipitakapali.org+2026-03-03" target="_blank">online form</a> to add missing words, especially from Vinaya, commentaries, and other later texts. If you prefer to work offline, here is a <a class="dpd-link" href="https://github.com/digitalpalidictionary/dpd-db/raw/main/misc/DPD%20Add%20Words.xlsx" download="true" target="_blank">spreadsheet to download</a><span>, fill in and submit. </span></p><p><a class="dpd-link" href="https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform?usp=pp_url&entry.438735500=#tpo_link@&entry.1433863141=Tipitakapali.org+2026-03-03" target="_blank">Correct a mistake</a><span>. Did you spot a mistake in the dictionary? Please report it. It generally takes less than a minute and your corrections and suggestions help to improve the quality of this dictionary for everyone who uses it.</span></p><p><a class="dpd-link" href="https://github.com/digitalpalidictionary/dpd-db/releases">Get updated</a><span>. You are using DPD Tipitakapali.org updated on <b>2026-03-03</b>. Check for an update every full moon uposatha day.</span></p><p><a class="dpd-link" href="https://digitalpalidictionary.github.io/">Visit the website</a><span>. Get more detailed information about installation and upgrades, advanced settings and features.</span></p><p><a class="dpd-link" href="mailto:digitalpalidictionary@gmail.com?subject=I'd%20like%20to%20help%20with%20code!&body=Please%20let%20me%20know%20how%20I%20can%20get%20involved%20with%20the%20development%20of%20DPD.">Help with coding</a><span>. If you're a coder and would like to support the project, please get in touch.</span></p><p><a class="dpd-link" href="mailto:digitalpalidictionary@gmail.com?subject=I%20want%20to%20help%20with%20DPD!&body=Please%20let%20me%20know%20how%20I%20can%20get%20involved%20with%20the%20development%20of%20DPD.">Help with Pāḷi</a><span>. If you have Pāḷi grammar skills and would like to assist, please make email contact.</span></p><p><a class="dpd-link" href="https://forms.gle/gJ7ouhJriYREPm1s8" target="_blank">Join the mailing list</a><span>. Get notified of updates and new features as soon as they become available.</span></p>`;

export function setDpdFeedbackTemplate(template) {
  if (template && typeof template === 'string' && template.trim().length > 10) {
    dpd_feedback_s = template.trim();
  }
}

export function restoreDPDFeedbackStr(html) {
  if (!html || typeof html !== 'string') return '';
  const feedbackMatchIds = [];
  let m;
  const regex = new RegExp(regExpFeedbackDPDId.source, 'g');
  while ((m = regex.exec(html)) !== null) {
    feedbackMatchIds.push([m[0], m[1]]);
  }

  if (feedbackMatchIds.length < 1) {
    return html;
  }

  let result = html;
  feedbackMatchIds.forEach(([entireMatchStr, idAndLemma]) => {
    const [id, lemma] = (idAndLemma || '').split('=');
    let st = dpd_feedback_s.replaceAll('#tpo_id@', id || '');
    st = st.replaceAll('#tpo_word@', lemma || '');
    st = st.replaceAll('#tpo_link@', (lemma || '').replaceAll(' ', '%20'));
    result = result.replace(entireMatchStr, st);
  });

  return result;
}

export function restoreMinifiedLinks(html, restoreHelp = true) {
  if (!html || typeof html !== 'string') return '';
  let result = html;
  if (restoreHelp) {
    result = restoreDPDFeedbackStr(result);
  }
  reDPDLinks.forEach(([link, code]) => {
    result = result.replaceAll(code, link);
  });
  return result.trim();
}
