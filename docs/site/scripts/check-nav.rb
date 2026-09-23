# Fails when the guide and its sidebar disagree: a page in guide/ that
# _data/nav.yml does not list (unreachable except by URL, and skipped by the
# Previous / Next links), or a nav entry pointing at a page that does not exist.
#
#   ruby scripts/check-nav.rb      (from docs/site)

require "yaml"

root = File.expand_path("..", __dir__)
nav = YAML.load_file(File.join(root, "_data/nav.yml"))
listed = nav.flat_map { |section| section["pages"].map { |page| page["url"] } }
pages = Dir[File.join(root, "guide/*.md")].map { |path| "/guide/#{File.basename(path, ".md")}/" }

problems = []
(pages - listed).each { |url| problems << "#{url} exists but is not in _data/nav.yml" }
(listed - pages).each { |url| problems << "#{url} is in _data/nav.yml but has no guide page" }
listed.tally.each { |url, count| problems << "#{url} is listed #{count} times" if count > 1 }

if problems.empty?
  puts "nav: #{listed.size} guide pages, all listed once"
else
  warn problems.map { |problem| "nav: #{problem}" }
  exit 1
end
