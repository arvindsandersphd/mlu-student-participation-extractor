# 🧠 Psych Rush: a live quiz game for Intro Psych

Psych Rush is a bright, fast, multiple-choice quiz game for class.

- A **host** (you or a TA) makes a game and gets a 6-digit **join code**.
- **Students** join from their phones with the code and a nickname. They don't need an account or an app.
- Each question has **four answer choices** and a **timer**. Students earn more points for **right answers** and for **answering faster**.
- After each question, everyone sees the **right answer** and a **live leaderboard**.
- The game ends with a **podium** for the top three, with confetti.
- There are **four game modes**, a **question editor**, and **spreadsheet import**.
- Sounds can be turned off with the 🔊 button.

**You do not need a projector.** Students see the question and the answer buttons on their own phones. The host screen is a bonus you can show on a projector or share in Zoom.

**Privacy:** student nicknames are kept only in the server's memory while the game is running. They are **deleted the moment the game ends**, and they are never written to a file. Students never type their real names, email addresses, or student IDs.

---

## Contents

1. [Try it on your own computer](#part-1-try-it-on-your-own-computer)
2. [Put it online so your TAs can use it](#part-2-put-it-online-so-your-tas-can-use-it)
3. [Running a game (in class, online, or without a projector)](#part-3-running-a-game)
4. [Making question sets](#part-4-making-question-sets)
5. [Game modes](#part-5-game-modes)
6. [Troubleshooting](#part-6-troubleshooting)

---

## Part 1: Try it on your own computer

You only need to do steps 1 and 2 once.

**Step 1. Install Node.js** (the free program that runs the game).
1. Go to **https://nodejs.org**.
2. Click the big button that says **LTS** to download it.
3. Open the file you downloaded and click **Next / Continue** until it finishes. The default choices are fine.

**Step 2. Get the game files.**
1. On GitHub, open this repository.
2. Choose the branch `claude/blooket-psychology-quiz-n25kbs` (or `main`, once this work is merged).
3. Click the green **Code** button, then **Download ZIP**.
4. Unzip it. You'll get a folder. Inside it is a folder called **`psych-quiz`**.

**Step 3. Open a terminal in the `psych-quiz` folder.**
- **Mac:** Open the **Terminal** app. Type `cd ` (with a space after it), drag the `psych-quiz` folder onto the Terminal window, and press **Return**.
- **Windows:** Open the `psych-quiz` folder in File Explorer. Click in the address bar at the top, type `cmd`, and press **Enter**.

**Step 4. Install the game (first time only).** Type this and press Enter:

```
npm install
```

Wait until it finishes. It takes about a minute.

**Step 5. Start the game.** Type this and press Enter:

```
npm start
```

You'll see a message saying **"Psych Rush is running!"** Leave this window open. Closing it stops the game.

**Step 6. Play a test game.**
1. In your web browser, go to **http://localhost:3000/host**.
2. Pick **Intro Psych Sampler**, pick a game mode, and click **Create game**.
3. Open a second browser window (or use your phone; see the note below) and go to **http://localhost:3000**. Type the code and a nickname.
4. Back on the host window, click **Start game**.

> **Phones on your computer's Wi-Fi:** the terminal also shows an address like `http://192.168.1.23:3000`. Phones on the **same Wi-Fi** can try that address. Campus Wi-Fi often blocks this, so for real classes use the online version in Part 2.

To stop the game server, click the terminal window and press **Ctrl + C**.

---

## Part 2: Put it online so your TAs can use it

Putting it online gives you one web address that you, your TAs, and your students can all use from any laptop or phone, in class or at home. These steps use **Render**, which has a free plan and supports live games.

**Step 1. Make an account.** Go to **https://render.com** and click **Get Started**. Choose **Sign up with GitHub** and use the GitHub account that has this repository.

**Step 2. Make a new web service.**
1. In Render, click **New +** and then **Web Service**.
2. Choose **Build and deploy from a Git repository** (if asked), then pick this repository. If you don't see it, click the link to let Render see your repositories.

**Step 3. Fill in the settings** exactly like this:

| Setting | What to type or choose |
|---|---|
| Name | `psych-rush` (or any name; it becomes part of the web address) |
| Branch | `main` (or `claude/blooket-psychology-quiz-n25kbs` if it isn't merged yet) |
| Root Directory | `psych-quiz` |
| Runtime / Language | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | `Free` |

**Step 4. Set a teacher password** (strongly recommended). Without one, anyone who finds the site could host games or change your question sets.
1. Find **Environment Variables** (on the same page, or under **Environment** later).
2. Click **Add Environment Variable**.
3. **Key:** `TEACHER_PASSWORD`. **Value:** a password you choose, such as `psych-fall26-rocks`.

Students never need this password. Only people who **host** or **edit question sets** do.

**Step 5. Click "Create Web Service"** (or **Deploy**). Wait a few minutes. When it says **Live**, your web address appears near the top, like `https://psych-rush.onrender.com`.

**Step 6. Share it.**
- **TAs:** send them the address plus `/host`, for example `https://psych-rush.onrender.com/host`, and the teacher password.
- **Students:** they go to the plain address, for example `https://psych-rush.onrender.com`, and type the code.

### Two things to know about the free plan

1. **It falls asleep.** After about 15 minutes with no visitors, the free plan pauses. The next visit takes up to a minute to wake it. **Open the host page a couple of minutes before class**, and it will be awake when students join.
2. **Sets you save on the website can disappear.** The free plan resets its files whenever it restarts or updates. So keep your question sets **as spreadsheets in GitHub**, where they're safe:
   1. On GitHub, open the repository, then the **`psych-quiz`** folder, then **`question-sets`**.
   2. Click **Add file** and then **Upload files**.
   3. Drag in your `.xlsx` or `.csv` file. (See [the spreadsheet format](#the-spreadsheet-format).)
   4. Click **Commit changes**. Render updates the site by itself in a few minutes.

   The set then shows up in the host page's list with a 📄 icon, named after the file. It stays there for good. If you make a set in the editor on the website, click **Download** next to it in the set list to save a copy you can upload this way.

   (If you want saving on the website to be permanent, Render sells an add-on "persistent disk". If you add one, set the environment variable `SETS_DIR` to the disk's folder path. You don't need this if you keep sets in GitHub.)

---

## Part 3: Running a game

### Starting a game (host)
1. Go to the site's **/host** page (for example `https://psych-rush.onrender.com/host`). Type the teacher password if asked.
2. Pick a **question set**.
3. Pick a **game mode** (see [Part 5](#part-5-game-modes)).
4. Pick the **seconds per question**. You can also shuffle the questions, shuffle the answer choices, or use only some of the questions.
5. Click **Create game**. A big **game code** appears.
6. Students join. Their nicknames pop up on screen. To remove someone with an inappropriate name, click the ✕ next to it.
7. Click **Start game**.
8. Each question ends when the timer runs out or when everyone has answered. You can also click **Stop timer & show answer**.
9. The right answer and the leaderboard appear. Click **Next question** when you're ready. (The space bar and Enter also work, and so do most presentation clickers.)
10. After the last question, click **Show podium** 🏆.

### In a classroom
Show the host screen on the projector if you have one. Click **⛶ Full screen** for a cleaner look. If there's no projector, that's fine: the host can run it from a laptop, and students read everything on their phones.

### Online class (Zoom, Teams, and similar)
1. Start the game, then click **📋 Copy join link** and paste the link into the meeting chat. The link fills in the code for students.
2. If you like, share your screen with the host page so everyone sees the leaderboard and podium. Students can play without it.
3. Video calls lag a little, so choose **30 seconds or more** per question, or use **No Rush** mode, where speed doesn't matter.

### A TA running it outside of class time
It works the same way. The TA opens `/host`, makes the game, and sends students the join link (by chat, email, or the LMS). Students join from wherever they are. The game runs live, so the TA needs to be there to click **Start** and **Next**.

### If something goes wrong mid-game
- **A student's phone locks or loses Wi-Fi:** they can open the page again (same browser tab), and they're put back in with their score.
- **The host's page reloads:** open `/host` again in the same tab, and the game picks up where it was.
- **The game gets abandoned:** it's deleted automatically, with all nicknames, after 20 minutes without a host.

---

## Part 4: Making question sets

Go to **/editor** (or click **✏️ Edit / add sets** on the host page). From the set list you can **Host**, **Edit**, **Duplicate**, **Download** (as a spreadsheet file), or **Delete** a set.

Every question needs **four answer choices** and **one right answer**. You can add questions three ways:

**1. Type them.** Click **＋ New set**, give it a title, and type each question and its four choices. Click the round button next to the right answer. "Seconds" is optional; it overrides the game's timer for that one question, which is handy for long questions. Click **💾 Save set** when you're done.

**2. Paste from a spreadsheet.** On the editor's **Paste from a spreadsheet** tab, copy rows from Excel or Google Sheets and paste them in. Then click **Add these questions** and **Save**.

**3. Import a spreadsheet file.** Use **Import a file** in a set, or **Import a spreadsheet as a new set** on the set list. This works with `.xlsx` files (Excel, or Google Sheets via **File → Download → Microsoft Excel**) and `.csv` files.

### The spreadsheet format
Put one question per row, in these columns:

| Question | Choice A | Choice B | Choice C | Choice D | Correct | Seconds (optional) |
|---|---|---|---|---|---|---|
| Who founded psychoanalysis? | Skinner | Freud | Rogers | Wundt | B | |
| Which lobe processes vision? | Frontal | Temporal | Parietal | Occipital | D | 30 |

- **Correct** can be a letter (**A, B, C, D**), a number (**1–4**), or the exact text of the right answer.
- A header row is fine. It gets skipped automatically.
- Rows with a problem (for example, only three choices) are skipped, and the editor tells you which rows they were.
- A ready-to-use example is in **`examples/intro-psych-sample.xlsx`**. The editor also has a **Download a template** link.

---

## Part 5: Game modes

| Mode | How points are won |
|---|---|
| **Classic** | A right answer earns 500 to 1000 points. The faster you answer, the more you get. A wrong answer earns 0. |
| **Streak Surge** | Same speed points, multiplied by your streak of right answers in a row: ×1, ×1.5, ×2, ×2.5, up to ×3. One wrong answer resets the streak. This rewards steady studying. |
| **Mystery Boxes** | Answer right, and you earn speed points **and** get to pick one of three mystery boxes on your phone. A box might hold +250, +500, a **Double** or **Triple** of that question's points, a **Steal** (take 20% of the points of someone ahead of you), or nothing at all. Great for comebacks. The host screen shows how many boxes have been opened, and boxes not picked by "Next" are opened automatically. |
| **No Rush** | Every right answer is worth exactly 1000 points. Speed doesn't matter. This is good for online classes, slower connections, students with accommodations, or harder questions. |

Ties are broken by the number of right answers.

---

## Part 6: Troubleshooting

| Problem | What to do |
|---|---|
| `npm` is "not recognized" or "command not found" | Node.js isn't installed, or the terminal was open before you installed it. Install Node.js (Part 1, Step 1), then close and reopen the terminal. |
| "Port 3000 is already in use" | Psych Rush is already running in another terminal window. Use that one, or close it first. |
| Students' phones can't reach `localhost` | `localhost` only works on the computer running the game. Put it online (Part 2). |
| The online site takes a minute to load | The free plan was asleep. Open it a few minutes before class. |
| A set I saved on the website disappeared | The free plan reset. Keep sets as spreadsheets in GitHub (Part 2, "Two things to know"). |
| An old `.xls` file won't import | In Excel, choose **File → Save As → Excel Workbook (.xlsx)** and import that file instead. |
| No sound | Click the 🔊 button. Browsers only play sound after you click or tap the page once. Check the computer's volume too. |
| A student picked a rude nickname | Click ✕ next to the name in the lobby. A short list of offensive words is also blocked automatically. |

---

### For the technically curious
- `server.js` runs the web server, the question-set storage, and the live game connections (Socket.IO).
- `lib/game.js` holds the game rules and scoring. `lib/importer.js` reads `.xlsx` and `.csv` files.
- `public/` holds the three web pages: `index.html` (students), `host.html` (host), and `editor.html` (question sets).
- `question-sets/` holds the saved sets (`.json`) and any spreadsheets you drop in.
- Settings (all optional): `PORT` (default 3000), `TEACHER_PASSWORD`, and `SETS_DIR`.
- `npm test` plays full simulated games in every mode to check that everything works.
