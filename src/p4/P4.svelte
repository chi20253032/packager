<script>
  import {_} from '../locales/';
  import {fade} from 'svelte/transition';
  import ComplexMessage from './ComplexMessage.svelte';
  import Section from './Section.svelte';
  import SelectProject from './SelectProject.svelte';
  import SelectLocale from './SelectLocale.svelte';
  import SelectTheme from './SelectTheme.svelte';
  import Progress from './Progress.svelte';
  import Modals from './Modals.svelte';
  import News from './News.svelte';
  import {progress, theme, error} from './stores';
  import {isSupported, isSafari, isStandalone, version} from './environment';
  import {
    APP_NAME,
    FEEDBACK_PRIMARY,
    FEEDBACK_SECONDARY,
    ACCENT_COLOR,
    SOURCE_CODE,
    WEBSITE,
    DONATE,
    PRIVACY_POLICY
  } from '../packager/brand';

  let projectData;

  const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  let systemTheme = darkMedia.matches ? 'dark' : 'light';
  if (darkMedia.addEventListener) {
    darkMedia.addEventListener('change', () => {
      systemTheme = darkMedia.matches ? 'dark' : 'light';
    });
  }
  $: document.documentElement.setAttribute('theme', $theme === 'system' ? systemTheme : $theme);

  let modalVisible = false;

  const defaultTitle = document.title;
  let title = '';
  $: document.title = projectData && title ? `${title} - ${APP_NAME}` : defaultTitle;

  const getPackagerOptionsComponent = () => import(
    /* webpackChunkName: "packager-options-ui" */
    './PackagerOptions.svelte'
  ).catch((err) => {
    $error = err;
  });

  // We know for sure we will need this component very soon, so start loading it immediately.
  getPackagerOptionsComponent();
</script>

<style>
  :root {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    background: white;
    color: black;
  }
  :global([theme="dark"]) {
    background: #111;
    color: #eee;
    color-scheme: dark;
  }
  :global(a) {
    color: blue;
  }
  :global([theme="dark"] a) {
    color: #56b2ff;
  }
  :global(a:active) {
    color: red;
  }
  :global(input[type="text"]),
  :global(input[type="number"]),
  :global(textarea) {
    padding: 2px;
  }
  :global(input[type="text"]),
  :global(input[type="number"]),
  :global(textarea),
  :global(.is-not-safari select) {
    background-color: white;
    color: black;
    border: 1px solid rgb(160, 160, 160);
    border-radius: 2px;
  }
  :global(.is-not-safari select:hover) {
    border-color: rgb(30, 30, 30);
  }
  :global([theme="dark"] input[type="text"]),
  :global([theme="dark"] input[type="number"]),
  :global([theme="dark"] textarea),
  :global([theme="dark"] .is-not-safari select) {
    background-color: #333;
    color: white;
    border-color: #888;
  }
  :global([theme="dark"] .is-not-safari select:hover) {
    border-color: #bbb;
  }
  :global(p), :global(h1), :global(h2), :global(h3) {
    margin: 12px 0;
  }
  :global(summary) {
    cursor: pointer;
  }
  :global(input) {
    font-size: 0.8em;
  }
  main {
    padding-bottom: 10px;
  }
  footer {
    text-align: center;
  }
  footer > div {
    margin-top: 12px;
  }
  .disclaimer {
    font-style: italic;
  }
  .version {
    font-size: small;
    opacity: 0.8;
  }
  .version a {
    color: inherit;
  }

  :global(html) {
    min-width: 320px;
    min-height: 100%;
    background: #f4f6fb;
    scroll-behavior: smooth;
  }
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(ellipse at 12% 0%, rgba(76, 151, 255, .13), transparent 38rem),
      radial-gradient(ellipse at 92% 18%, rgba(153, 102, 255, .10), transparent 34rem),
      #f4f6fb;
    color: #182235;
    -webkit-tap-highlight-color: transparent;
  }
  :global([theme="dark"] body) {
    background:
      radial-gradient(ellipse at 12% 0%, rgba(76, 151, 255, .16), transparent 38rem),
      radial-gradient(ellipse at 92% 18%, rgba(153, 102, 255, .12), transparent 34rem),
      #101522;
    color: #edf2ff;
  }
  main {
    width: min(100% - 28px, 1040px);
    margin: 0 auto;
    padding: 18px 0 34px;
  }
  :global(.card) {
    box-sizing: border-box;
    width: 100%;
    max-width: 920px;
    margin: 16px auto;
    padding: clamp(18px, 3vw, 30px);
    border: 1px solid rgba(115, 132, 160, .18);
    border-radius: 22px;
    background: rgba(255, 255, 255, .92);
    box-shadow: 0 12px 34px rgba(31, 48, 78, .075);
    backdrop-filter: blur(12px);
  }
  :global([theme="dark"] .card) {
    background: rgba(28, 36, 53, .94);
    border-color: rgba(160, 178, 210, .16);
    box-shadow: 0 14px 36px rgba(0, 0, 0, .22);
  }
  :global(h1) {
    font-size: clamp(1.8rem, 5vw, 2.6rem);
    line-height: 1.12;
    letter-spacing: -.045em;
    font-weight: 800;
  }
  :global(h2) {
    font-size: clamp(1.25rem, 3vw, 1.55rem);
    letter-spacing: -.025em;
    font-weight: 750;
  }
  :global(h3) {
    margin-top: 24px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(120, 140, 170, .22);
    font-size: 1.05rem;
  }
  :global(p) {
    line-height: 1.65;
  }
  :global(input:not([type="checkbox"]):not([type="radio"])),
  :global(textarea),
  :global(select) {
    box-sizing: border-box;
    max-width: 100%;
    min-height: 42px;
    padding: 9px 12px;
    border: 1px solid #b8c4d6;
    border-radius: 11px;
    font: inherit;
    font-size: 16px;
    background: #fff;
    color: #182235;
  }
  :global(textarea) {
    min-height: 150px;
  }
  :global([theme="dark"] input:not([type="checkbox"]):not([type="radio"])),
  :global([theme="dark"] textarea),
  :global([theme="dark"] select) {
    background: #151d2d;
    color: #edf2ff;
    border-color: #53627c;
  }
  :global(input[type="checkbox"]),
  :global(input[type="radio"]) {
    width: 19px;
    height: 19px;
    accent-color: #3978e8;
    vertical-align: middle;
  }
  :global(button) {
    min-height: 44px;
    border-radius: 12px;
    font: inherit;
    font-size: 16px;
    touch-action: manipulation;
  }
  :global(a) {
    text-underline-offset: 3px;
  }
  :global(a:focus-visible),
  :global(button:focus-visible),
  :global(input:focus-visible),
  :global(select:focus-visible),
  :global(textarea:focus-visible),
  :global(summary:focus-visible) {
    outline: 3px solid rgba(57, 120, 232, .45);
    outline-offset: 2px;
  }
  footer {
    max-width: 920px;
    margin: 26px auto 0;
    padding: 18px;
    color: #65738a;
    font-size: .92rem;
    line-height: 1.8;
  }
  :global([theme="dark"]) footer {
    color: #aab6ca;
  }
  @media (max-width: 640px) {
    main {
      width: min(100% - 16px, 1040px);
      padding-top: 8px;
    }
    :global(.card) {
      margin: 9px auto;
      padding: 17px;
      border-radius: 17px;
    }
    :global(.option) {
      overflow-wrap: anywhere;
    }
    :global(input[type="text"]),
    :global(input[type="number"]),
    :global(select) {
      max-width: 100%;
    }
    footer {
      padding: 12px 6px 26px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(*), :global(*::before), :global(*::after) {
      scroll-behavior: auto !important;
      animation-duration: .01ms !important;
      transition-duration: .01ms !important;
    }
  }

</style>

<Modals bind:modalVisible={modalVisible} />

<main aria-hidden={modalVisible} class:is-not-safari={!isSafari}>
  <Section accent={ACCENT_COLOR}>
    <div>
      <h1>{APP_NAME}</h1>
      {#if version}
        <p class="version">
          {version}
          {#if isStandalone}
            - <a href={WEBSITE}>{WEBSITE}</a>
          {/if}
        </p>
      {/if}
      <p>{$_('p4.description1')}</p>
      <p>
        <ComplexMessage
          message={$_('p4.description2')}
          values={{
            embedding: {
              text: $_('p4.description2-embedding'),
              href: 'https://docs.turbowarp.org/embedding'
            }
          }}
        />
      </p>
      <p>
        <ComplexMessage
          message={$_('p4.description3')}
          values={{
            // These placeholders are named this way for legacy reasons.
            onScratch: {
              text: $_('p4.description3-on').replace('{brand}', FEEDBACK_PRIMARY.name),
              href: FEEDBACK_PRIMARY.link
            },
            onGitHub: {
              text: $_('p4.description3-on').replace('{brand}', FEEDBACK_SECONDARY.name),
              href: FEEDBACK_SECONDARY.link
            }
          }}
        />
      </p>
      <p class="disclaimer">
        {$_('p4.disclaimer')}
      </p>
    </div>
  </Section>

  {#if !isStandalone}
    <News />
  {/if}

  {#if isSupported}
    <SelectProject bind:projectData />
  {:else}
    <Section accent="#4C97FF">
      <h2>{$_('p4.browserNotSupported')}</h2>
      <p>{$_('p4.browserNotSupportedDescription')}</p>
    </Section>
  {/if}

  {#if projectData}
    {#await getPackagerOptionsComponent()}
      <Section center>
        <Progress text={$_('p4.importingInterface')} />
      </Section>
    {:then { default: PackagerOptions }}
      <div in:fade>
        <PackagerOptions
          projectData={projectData}
          bind:title={title}
        />
      </div>
    {:catch}
      <Section center>
        <p>
          {$_('p4.unknownImportError')}
        </p>
      </Section>
    {/await}
  {/if}

  {#if $progress.visible}
    <Section center>
      <Progress progress={$progress.progress} text={$progress.text} />
    </Section>
  {/if}

  <footer>
    <div>
      {#if PRIVACY_POLICY && !isStandalone}
        <a href={PRIVACY_POLICY}>{$_('p4.privacy')}</a>
        <span> - </span>
      {/if}
      <a href={FEEDBACK_PRIMARY.link}>{$_('p4.feedback')}</a>
      {#if SOURCE_CODE}
        <span> - </span>
        <a href={SOURCE_CODE}>{$_('p4.sourceCode')}</a>
      {/if}
      {#if DONATE}
        <!-- Donation link needs to be wrapped in another element so we can hide it in the Mac App Store -->
        <span class="donate-link">
          <span> - </span>
          <a href={DONATE}>{$_('p4.donate')}</a>
        </span>
      {/if}
    </div>
    <div>
      <a href="https://docs.turbowarp.org/packager">{$_('p4.documentation')}</a>
    </div>
    <div>
      <SelectTheme />
    </div>
    <div>
      <SelectLocale />
    </div>
  </footer>
</main>
