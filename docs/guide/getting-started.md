# Getting Started

This page takes you from nothing installed to your **first space-time analysis**.
You run the whole platform with **Docker** — one free app to install and two
copy-paste commands. **No download, no coding, and no programming knowledge is
required.**

The path is four steps:

1. **[Install Docker Desktop](#step-1-—-install-docker-desktop)** — the free app that runs everything for you.
2. **[Start the app](#step-2-—-start-the-app)** — launch the two ready-made images.
3. **[Open it](#step-3-—-open-the-app-in-your-browser)** in your browser.
4. **[Run your first analysis](#step-4-—-run-your-first-space-time-analysis)** on a sample trajectory.

Everything after Step 4 — starting and stopping, updating, building from source,
and troubleshooting — is reference you can come back to later.

## Step 1 — Install Docker Desktop

Docker is a free program that runs Time Geography Kepler for you, so you don't
have to install anything else.

1. Go to **<https://www.docker.com/products/docker-desktop/>**.
2. Download **Docker Desktop** for your system (Windows, Mac, or Linux) and
   install it like any other app.
3. **Open Docker Desktop** and wait until it says **"Docker Desktop is running"**
   (you'll see a small whale icon in your menu bar / system tray).

::: warning Keep Docker open
Docker Desktop must be **running** every time you start the app. If it's closed,
the commands in Step 2 will fail with a "cannot connect" error — just open Docker
Desktop and try again.
:::

## Step 2 — Start the app

The app is published ready-made on Docker Hub, so **you don't need to download
anything**. Pick whichever way you prefer — both do exactly the same thing.

### Option A — Right inside Docker Desktop (no terminal)

You can pull and start both parts without typing a single command:

1. Open **Docker Desktop** and click the **search bar** at the very top.
2. Type **`yongzwu/time-geography-backend`**, then click **Pull** on the matching
   image.
3. Search again for **`yongzwu/time-geography-frontend`** and **Pull** it too.
4. Click the **Images** tab on the left. Next to **time-geography-backend**, press
   the **Run** (▶) button. In the pop-up, open **Optional settings** and fill in:
   - **Container name:** `tgk-backend`
   - **Host port:** `8000`

   Then click **Run**.
5. Do the same for **time-geography-frontend**, but use:
   - **Container name:** `tgk-frontend`
   - **Host port:** `5173`

Both parts now appear under the **Containers** tab with a green **Running**
status. (Later, you start and stop them with the **▶ / ■** buttons there — no need
to repeat this setup.)

### Option B — Two commands (fastest)

::: details How do I open a terminal?
- **Windows:** click **Start**, type `powershell`, press Enter.
- **Mac:** press **Cmd + Space**, type `Terminal`, press Enter.
- **Linux:** open your **Terminal** app.

You can open it **anywhere** — these commands don't depend on any folder.
:::

Copy each line, paste it, and press Enter (run them one at a time):

```bash
docker run -d --name tgk-backend -p 8000:8000 yongzwu/time-geography-backend:latest
docker run -d --name tgk-frontend -p 5173:80 yongzwu/time-geography-frontend:latest
```

Each command prints a long line of letters and numbers when it works — that part
is now running in the background.

::: tip First time is slower
Whichever option you pick, the **first** start downloads the app (a few minutes,
depending on your internet speed). That's normal, and it's instant every time
after. If you ever see **"name is already in use"**, the app is already
installed — just press **▶ Start** in the **Containers** tab instead.
:::

## Step 3 — Open the app in your browser

Go to:

### 👉 <http://localhost:5173>

You should see the **Space-Time Analytics Platform** home screen. That's it — the
app is running on your own computer.

![Initial page](/getting-started/initial-page.png)

## Step 4 — Run your first space-time analysis

With the app open, you'll work through two things on the same dataset: first
**visualize a GPS trajectory in 3D**, then build a **Space-Time Prism** from it.
Both run on the sample below — no data of your own required.

### Visualize the trajectory in 3D

1. **Load a trajectory.** Open the **Data** panel and choose **Upload → CSV
   File**. Don't have data yet? Download this small sample first, then upload it:
   <a href="/time-geography-kepler/example_1.csv" download="example_1.csv">example_1.csv</a>
   — one real person's GPS trace for a single day (~800 points, a clean
   home → activity → home round trip). In the **Map Coordinate Columns** step,
   the **longitude**, **latitude**, and **altitude** columns are detected
   automatically, so just confirm and finish.

   ![Upload data](/getting-started/data-source.png)
   ![Map columns](/getting-started/map-columns.png)

2. **Pick a tool.** On the **Select Analysis Tool** screen, choose **3D
   Trajectory** — it plots your GPS points in 3D so you can inspect the path
   before analyzing it.

   ![Select the 3D Trajectory tool](/getting-started/select-tool.png)

3. **Check the datetime column.** The app auto-detects the time column —
   `dataTime` in this sample — and pre-fills it, so you can leave it as-is. The
   vertical time axis depends on this field, so if it's ever empty, pick the
   column that holds your timestamps. Feel free to explore the other settings.

   ![Check the datetime column](/getting-started/tool-setting.png)

4. **Run and explore.** Click **Run Analysis**, then **right-click and drag** to
   rotate the map until the vertical time axis comes into view. Hover any point
   to read its values.

   ![Visualized trajectory](/getting-started/visualized-trajectory.png)

That's a complete space-time visualization. From here you can try the analytical
tools — [Space-Time Kernel Density](/tools/stkde),
[Space-Time Cube](/tools/space-time-cube), and
[Space-Time Prism](/tools/space-time-prism). Let's build a Space-Time Prism
together.

### Build a Space-Time Prism

1. **Set the start and end anchors.** Click the home location on the map to drop
   the **start anchor**, then click one of the stays to drop the **end anchor**.
   The prism will fill the space-time region the person could have reached
   between these two points.

   ![Select the home location as the start anchor](/getting-started/select-home-anchor.png)
   ![Select an activity stay as the end anchor](/getting-started/select-end-anchor.png)

2. **Configure the prism.** Click **Build Space-Time Prism**, and the settings
   panel opens on the right side of the map. Adjust it to your needs. This
   example uses a **60 km/h** travel speed with no speed adjustment
   (**Free-flow**). To make the speed approximate the user's actual travel speed,
   switch **Free-flow** to **Auto**.

   ![Space-Time Prism settings](/getting-started/stp-tool-setting.png)

3. **Run it.** Click **Run**. The prism is computed on your own computer and can
   take anywhere from under a minute to several minutes, depending on your
   settings. When it finishes, a heat map of the potential dwell time appears,
   alongside a 3D rendering of that dwell surface.

   ![Space-Time Prism result](/getting-started/stp-result.png)

4. **Take a closer look.** For a closer view, click **Focused 3D View** at the
   bottom-left of the map. It zooms in on the prism and clearly shows the
   potential path area at each time slice between the start and end anchors.
   **Right-click and drag** to change the viewing angle, or press the play button
   to animate the prism over time.

   ![Focused 3D View](/getting-started/stp-focused.png)

