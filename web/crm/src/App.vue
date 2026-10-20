<script setup lang="ts">
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <RouterView />
    <Toaster />
  </TooltipProvider>
</template>
