<template>
  <div class="stagger-in space-y-4 px-4 pb-6 pt-4">
    <SectionTitle title="设置" />

    <SettingsAccountSection />

    <SectionTitle title="VIP 托管" />
    <SettingsVipSection />

    <SectionTitle title="偏好" />
    <SettingsPreferenceSection />

    <SectionTitle title="存档" />
    <SettingsSaveSection />

    <SectionTitle title="诊断" />
    <SettingsDiagnosticsSection />

    <!-- iOS 专属,非 iOS 不显示(见组件注释) -->
    <InstallToHomeNotice permanent />

    <SectionTitle title="关于" />
    <SettingsAboutSection />
  </div>
</template>

<script setup lang="ts">
  import SectionTitle from '@/components/common/SectionTitle.vue'
  import InstallToHomeNotice from '@/components/common/InstallToHomeNotice.vue'
  import SettingsAccountSection from '@/components/settings/SettingsAccountSection.vue'
  import SettingsVipSection from '@/components/settings/SettingsVipSection.vue'
  import SettingsPreferenceSection from '@/components/settings/SettingsPreferenceSection.vue'
  import SettingsSaveSection from '@/components/settings/SettingsSaveSection.vue'
  import SettingsDiagnosticsSection from '@/components/settings/SettingsDiagnosticsSection.vue'
  import SettingsAboutSection from '@/components/settings/SettingsAboutSection.vue'
</script>
