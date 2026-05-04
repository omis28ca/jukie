<template>
  <main class="shell">
    <header class="header">
      <h1>Office Jukebox</h1>
      <nav>
        <RouterLink to="/">Now Playing</RouterLink>
        <RouterLink to="/library">Library</RouterLink>
        <RouterLink to="/upload">Upload</RouterLink>
        <RouterLink to="/admin">Admin</RouterLink>
      </nav>
    </header>

    <RouterView />
  </main>
</template>
