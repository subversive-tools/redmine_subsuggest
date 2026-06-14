# Plugin redmine_subsuggest
# Provides smart linking and wiki macro autocomplete in all Redmine wiki text areas.
#
# Features:
#   {{ — Makro-Autocomplete (mit Beschreibung und Detail-Panel)
#   @  — Sofort-Dropdown ab erstem Zeichen (max. 10 Einträge)
#   >> — Smart Linker: Projekt → Issues | Mitglieder | Wiki | E-Mail | Weblink | Anhang
#
# init.rb is executed by Redmine::PluginLoader INSIDE its own to_prepare block,
# so we apply hooks directly here — no nested Rails.configuration.to_prepare needed.

require 'redmine'

Redmine::Plugin.register :redmine_subsuggest do
  name        'Subsuggest'
  author      'Stefan Mischke'
  description 'Enables quick access to Redmine objects and macros via trigger characters, contextual autocomplete, and an inline selection menu in any text field.'
  version     '0.5.1'
  url         'https://github.com/subversive-tools/redmine_subsuggest'
  author_url  'https://github.com/modoq'

  settings default: {
    'enable_macros' => '1',
    'enable_mentions' => '1',
    'enable_smart_linker' => '1',
    'smart_linker_trigger' => '>>'
  }, partial: 'settings/subsuggest_settings'
end

# Load the hook class — self-registers with Redmine::Hook on load
require_relative 'lib/subsuggest_hook'
SubsuggestHook
