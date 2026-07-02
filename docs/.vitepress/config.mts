import { defineConfig } from 'vitepress'

// Project site on GitHub Pages → served under /time-geography-kepler/
const base = '/time-geography-kepler/'

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'Time Geography Kepler',
  description:
    'Interactive space-time trajectory analysis — 3D trajectories, kernel density, space-time cubes, and space-time prisms in the browser.',

  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  head: [
    ['meta', { name: 'theme-color', content: '#2563eb' }],
    ['meta', { property: 'og:title', content: 'Time Geography Kepler' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Interactive space-time trajectory analysis platform.',
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Tools', link: '/tools/', activeMatch: '/tools/' },
      { text: 'Reference', link: '/reference/api', activeMatch: '/reference/' },
      {
        text: 'v1.0.0',
        items: [
          {
            text: 'Changelog',
            link: 'https://github.com/WYZDevin/time-geography-kepler/commits/main',
          },
          {
            text: 'Report an issue',
            link: 'https://github.com/WYZDevin/time-geography-kepler/issues',
          },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is it?', link: '/guide/introduction' },
            { text: 'Core Concepts', link: '/guide/concepts' },
            { text: 'Getting Started', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Using the App',
          items: [
            { text: 'Preparing Your Data', link: '/guide/data-format' },
            { text: 'Running an Analysis', link: '/guide/workflow' },
            { text: 'Map Controls & Pins', link: '/guide/map-controls' },
          ],
        },
      ],
      '/tools/': [
        {
          text: 'Tools',
          items: [
            { text: 'Overview', link: '/tools/' },
            {
              text: '3D Trajectory',
              link: '/tools/trajectory-3d',
              items: [{ text: 'Algorithm', link: '/tools/trajectory-3d-algorithm' }],
            },
            {
              text: 'Space-Time Kernel Density',
              link: '/tools/stkde',
              items: [{ text: 'Algorithm', link: '/tools/stkde-algorithm' }],
            },
            {
              text: 'Space-Time Cube',
              link: '/tools/space-time-cube',
              items: [{ text: 'Algorithm', link: '/tools/space-time-cube-algorithm' }],
            },
            {
              text: 'Space-Time Prism',
              link: '/tools/space-time-prism',
              items: [{ text: 'Algorithm', link: '/tools/space-time-prism-algorithm' }],
            },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'Backend API', link: '/reference/api' },
            { text: 'Deployment', link: '/reference/deployment' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/WYZDevin/time-geography-kepler' },
    ],

    search: { provider: 'local' },

    editLink: {
      pattern:
        'https://github.com/WYZDevin/time-geography-kepler/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the ISC License.',
      copyright: 'Copyright © 2026 Time Geography Kepler',
    },

    outline: { level: [2, 3] },
  },
})
