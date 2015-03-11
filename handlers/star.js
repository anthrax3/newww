var PackageModel = require('../models/package');

module.exports = function (request, reply) {
  var Package = PackageModel.new(request);

  var opts = {
    user: request.auth.credentials
  };

  if (request.method === 'get') {
    return reply.redirect('browse/userstar/' + opts.user.name);
  }

  if (!opts.user) {
    request.logger.error('user is not logged in');
    reply('user is not logged in').code(403);
    return;
  }

  var username = opts.user.name,
      body = request.payload,
      pkg = body.name,
      starIt = !!body.isStarred.match(/true/i);

  if (starIt) {
    Package.star(pkg)
      .catch(function (err) {
        request.logger.error(username + ' was unable to star ' + pkg);
        request.logger.error(err);
        reply('not ok').code(500);
        return;
      })
      .then(function () {
        request.timing.page = 'star';
        request.metrics.metric({ name: 'star', package: pkg });
        return reply(username + ' starred ' + pkg).code(200);
      });

  } else {

    Package.unstar(pkg)
      .catch(function (err) {
        request.logger.error(username + ' was unable to unstar ' + pkg);
        request.logger.error(err);
        reply('not ok').code(500);
        return;
      })
      .then(function () {
        request.timing.page = 'unstar';
        request.metrics.metric({ name: 'unstar', package: pkg });

        return reply(username + ' unstarred ' + pkg).code(200);
      });
  }
};