<script setup lang="ts">
/**
 * Знак кабинета MarketHub — синяя плашка с градиентом и буквой, как в макете.
 * Буква, а не картинка: внешних ассетов нет, а шрифт уже в бандле.
 */
</script>

<template>
  <span
    class="inline-flex size-8 shrink-0 select-none items-center justify-center rounded-lg bg-gradient-to-br from-primary to-chart-6 text-base font-black text-primary-foreground shadow-md shadow-primary/25"
    aria-hidden="true"
  >
    M
  </span>
</template>
