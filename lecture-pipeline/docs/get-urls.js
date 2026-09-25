// Copy your signed lecture URLs from the McGill LRS player.
//
//  1. Open myCourses → your course → "Lecture Recordings".
//  2. When the recording list has loaded, press F12 → Console.
//  3. Paste this whole snippet and press Enter.
//
// It prints one line per recording (date + signed .m3u8 URL) and copies them all
// to your clipboard. Each URL contains YOUR session token and is valid for a few
// hours — treat it like a password and don't share it.
(async () => {
  const root = [...document.querySelectorAll('*')].find(e => e.__vue__).__vue__.$root;
  const token = root.$store.state.token;
  const recs = await fetch(
    'https://LRSWAPI.campus.mcgill.ca/api/MediaRecordings/dto/COURSE_ID',
    { headers: { Authorization: 'Bearer ' + token } }
  ).then(r => r.json());
  const out = recs
    .sort((a, b) => (a.dateTime < b.dateTime ? -1 : 1))
    .map(x => x.dateTime.slice(0, 10) + '\t' + x.sources[0].src)
    .join('\n');
  console.log(out);
  copy(out);
  console.log('\n^ copied to clipboard. Paste a URL into:  just fetch \'<url>\' <slug>');
})();
