# Appends ?v=<build time> to every image under /assets/, so a regenerated
# screenshot reaches visitors who have the old one cached. The screenshots keep
# their filenames when they are redone, and without this a browser — or Live
# Server locally — goes on showing the previous image until its cache expires.
#
# The stylesheet does the same in _includes/head.html.

Jekyll::Hooks.register [:pages, :documents], :post_render do |page|
  next unless page.output_ext == ".html"

  version = page.site.time.to_i
  page.output = page.output.gsub(%r{(<img\b[^>]*?\ssrc=")([^"?]*/assets/[^"?]+)(")}) do
    "#{Regexp.last_match(1)}#{Regexp.last_match(2)}?v=#{version}#{Regexp.last_match(3)}"
  end
end
