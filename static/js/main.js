function copyPad () {
  padRev = 'latest';
  padId = $(location).attr('href').split("/").pop();

  params = ["old=" + padId];
  if (padRev != 'latest')
    params.push("old_rev=" + padRev);
  params = params.join('&');

  window.location = "/copy?" + params;
}
