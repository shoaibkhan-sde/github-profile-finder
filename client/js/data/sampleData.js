/**
 * Sample profile data strictly matching the provided reference screenshot.
 * Used for initial UI preview, visual testing, and offline demonstrations.
 */
export const SAMPLE_PROFILE = {
  user: {
    login: 'octocat',
    name: 'The Octocat',
    avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
    html_url: 'https://github.com/octocat',
    bio: "GitHub's official mascot. This is a test account used for examples, documentation, and demos.",
    location: 'San Francisco',
    blog: 'https://github.com',
    joined_date: 'Joined Jan 2011',
    verified: true,
    stats: {
      followers: 8300,
      followers_formatted: '8.3K',
      following: 9,
      following_formatted: '9',
      public_repos: 8,
      public_repos_formatted: '8',
      total_stars: 3600,
      total_stars_formatted: '3.6K'
    }
  },
  popular_repositories: [
    {
      id: 1,
      name: 'Hello-World',
      description: 'This your first repo!',
      stars: 1700,
      stars_formatted: '1.7K',
      forks: 1200,
      forks_formatted: '1.2K',
      language: 'JavaScript',
      language_color: '#f1e05a',
      updated: 'Updated 6 years ago',
      html_url: 'https://github.com/octocat/Hello-World'
    },
    {
      id: 2,
      name: 'Spoon-Knife',
      description: 'This repo is for demonstration purposes only.',
      stars: 11600,
      stars_formatted: '11.6K',
      forks: 4200,
      forks_formatted: '4.2K',
      language: 'HTML',
      language_color: '#e34c26',
      updated: 'Updated 10 years ago',
      html_url: 'https://github.com/octocat/Spoon-Knife'
    },
    {
      id: 3,
      name: 'octocat.github.io',
      description: 'A test GitHub Pages site.',
      stars: 1100,
      stars_formatted: '1.1K',
      forks: 2100,
      forks_formatted: '2.1K',
      language: 'HTML',
      language_color: '#e34c26',
      updated: 'Updated 8 years ago',
      html_url: 'https://github.com/octocat/octocat.github.io'
    }
  ],
  top_languages: [
    { name: 'JavaScript', percentage: 42.1, color: '#f1e05a' },
    { name: 'HTML', percentage: 24.7, color: '#e34c26' },
    { name: 'CSS', percentage: 14.9, color: '#563d7c' },
    { name: 'Ruby', percentage: 11.2, color: '#701516' },
    { name: 'Other', percentage: 7.1, color: '#8b949e' }
  ],
  contributions: {
    total_in_year: '1,247 contributions in the last year',
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    // 7 rows x 52 columns pattern mimicking the screenshot's density
    density_seed: [
      0, 1, 0, 2, 0, 0, 3, 1, 0, 2, 4, 3, 0, 1, 2, 0, 3, 1, 0, 4, 2, 0, 1, 3,
      2, 0, 1, 4, 3, 0, 2, 1, 0, 3, 4, 2, 0, 1, 0, 3, 2, 4, 1, 0, 2, 3, 0, 1
    ]
  }
};

