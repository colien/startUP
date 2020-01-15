module.exports = {
  title: '我的 DOCS',
  description: '博客系统',
  theme: '@vuepress/theme-blog', // OR shortcut: @vuepress/blog
  base:"/blog-site/",
  themeConfig: {
    /**
     * Ref: https://vuepress-theme-blog.ulivz.com/#modifyblogpluginoptions
     */
    modifyBlogPluginOptions(blogPluginOptions) {
      return blogPluginOptions
    },
    /**
     * Ref: https://vuepress-theme-blog.ulivz.com/#nav
     */
    nav: [
      {
        text: 'Blog',
        link: '/',
      },
      {
        text: 'Tags',
        link: '/tag/',
      },
    ],
    /**
     * Ref: https://vuepress-theme-blog.ulivz.com/#footer
     */
    footer: {
      contact: [
        {
          type: 'github',
          link: 'https://github.com/colien',
        },
      ],
      copyright: [
        {
          text: 'MIT Licensed | Copyright © 2018-2020 colien',
          link: '',
        },
      ],
    },
  },
}
