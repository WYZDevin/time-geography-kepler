# Getting Started

You can run the whole platform with **Docker** — one free app to install and one
command to start. **No coding or programming knowledge is required.**

Follow the five steps below in order.

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
the command in Step 4 will fail with a "cannot connect" error — just open Docker
Desktop and try again.
:::

## Step 2 — Download the project

1. Open the project page: **<https://github.com/WYZDevin/time-geography-kepler>**
2. Click the green **`<> Code`** button, then **Download ZIP**.
3. **Unzip** the downloaded file. You'll get a folder named
   **`time-geography-kepler-main`**.
4. Move that folder somewhere easy to find, like your **Desktop** or
   **Documents**.

::: tip Remember where it is
You'll point the command at this folder in the next step, so note where you put
it (e.g. `Desktop/time-geography-kepler-main`).
:::

## Step 3 — Open a terminal **inside that folder**

A "terminal" is a window where you type commands. The important part is opening
it **inside the project folder** so the command runs in the right place.

::: code-group

```text [Windows]
1. Open the "time-geography-kepler-main" folder in File Explorer.
2. Click the address bar at the top (where the folder path is shown).
3. Type:  powershell
4. Press Enter.
A blue PowerShell window opens, already inside the folder.
```

```text [Mac]
1. Open the "Terminal" app:
   press Cmd + Space, type "Terminal", press Enter.
2. In the Terminal window type "cd " (the letters c, d, then a space):
      cd 
3. Drag the "time-geography-kepler-main" folder from Finder onto the
   Terminal window (this pastes its location), then press Enter.
```

```text [Linux]
1. Open your Files app and go into "time-geography-kepler-main".
2. Right-click an empty area inside the folder.
3. Choose "Open in Terminal".
```

:::

**Check you're in the right place.** In the terminal, type the line below and
press Enter — you should see `docker-compose.yml` listed:

::: code-group

```powershell [Windows]
dir
```

```bash [Mac / Linux]
ls
```

:::

If you don't see `docker-compose.yml`, you opened the terminal in the wrong
folder — go back to Step 3.

## Step 4 — Start the app

In that same terminal window, type this **exactly** and press Enter:

```bash
docker compose up --build
```

- The **first time**, this downloads and builds everything — it can take a few
  minutes. That's normal.
- It's ready when the text stops scrolling and you see the services running.
- **Leave this window open** while you use the app.

## Step 5 — Open the app in your browser

Go to:

### 👉 <http://localhost:5173>

You should see the **Space-Time Analytics Platform** home screen. That's it — the
app is running on your own computer.

## Stopping and restarting

- **To stop the app:** click the terminal window, press **`Ctrl + C`**, then type
  `docker compose down` and press Enter.
- **To start it again later:** open Docker Desktop, open a terminal in the folder
  (Step 3), and run — this time you can skip `--build`:

  ```bash
  docker compose up
  ```

## Your first analysis

1. Click **Data → Upload** and load a trajectory
   (try the included `example_day_2022-09-16.geojson` file from the project folder).
2. Pick a tool — start with **3D Trajectory**.
3. Map the **Datetime Column** to your timestamp field (e.g. `date_logged`).
4. Click **Run Analysis** and explore the 3D result.

Full walkthrough: [Running an Analysis](/guide/workflow).

## Troubleshooting

| Problem | What to do |
|---------|------------|
| **"Cannot connect to the Docker daemon"** | Docker Desktop isn't running — open it, wait for "Docker Desktop is running", then try Step 4 again. |
| **The command isn't found** (`docker: command not found`) | Docker Desktop isn't installed correctly — reinstall it (Step 1) and restart your computer. |
| **`docker-compose.yml` not listed in Step 3** | Your terminal is in the wrong folder. Redo Step 3 so the terminal opens inside `time-geography-kepler-main`. |
| **Nothing loads at `localhost:5173`** | Wait until the build in Step 4 finishes (the text stops scrolling), then refresh the browser. |
| **"Port is already in use"** | Another program is using the port. Close it, or restart your computer, then run Step 4 again. |
