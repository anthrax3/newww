var Org = require('../agents/org');
var Customer = require('../models/customer');
var User = require('../models/user');
var Promise = require('bluebird');
var Joi = require('joi');
var invalidUserName = require('npm-user-validate').username;

exports.getOrg = function(request, reply) {
  if (!request.features.org_billing) {
    return reply.redirect('/org');
  }

  var opts = {};

  var loggedInUser = request.loggedInUser && request.loggedInUser.name;
  request.customer.getById(request.loggedInUser.email, function(err, cust) {
    if (err) {
      request.logger.error(err);
      if (err.statusCode === 404) {
        return reply.view('errors/not-found', err).code(404);
      }
      return reply.view('errors/internal', err);
    }

    Org(loggedInUser)
      .get(request.params.org, function(err, org) {
        if (err) {
          request.logger.error(err);

          if (err.statusCode === 404) {
            return reply.view('errors/not-found', err).code(404);
          } else {
            return reply.view('errors/internal', err);
          }
        }

        opts.org = org;
        opts.org.users.items = org.users.items.map(function(user) {
          user.sponsoredByOrg = user.sponsored === 'by-org';
          return user;
        });
        opts.org.customer_id = cust.stripe_customer_id;
        return reply.view('org/info', opts);
      });

  });
};

exports.addUserToOrg = function(request, reply) {
  if (!request.features.org_billing) {
    return reply.redirect('/org');
  }

  var orgName = request.params.org;
  var loggedInUser = request.loggedInUser.name;
  var user = {
    user: request.payload.username,
    role: request.payload.role
  };
  var opts = {};

  Org(loggedInUser)
    .addUser(orgName, user, function(err, addedUser) {
      if (err) {
        return request.saveNotifications([
          Promise.reject(err.message)
        ]).then(function(token) {
          var url = '/org/' + orgName;
          var param = token ? "?notice=" + token : "";
          url = url + param;
          return reply.redirect(url);
        });
      }
      request.customer.getLicenseIdForOrg(orgName, function(err, licenseId) {
        if (err) {
          request.logger.error(err);
          return reply.view('errors/internal', err).code(404);
        }
        request.customer.extendSponsorship(licenseId, user.user, function(err, extendedSponsorship) {
          if (err) {
            request.logger.error(err);
            return reply.view('errors/internal', err).code(err.statusCode);
          }
          request.customer.acceptSponsorship(extendedSponsorship.verification_key, function(err) {
            if (err) {
              request.logger.error(err);
              if (err.statusCode !== 403) {
                return reply.view('errors/internal', err).code(err.statusCode);
              }
            }
            return exports.getOrg(request, reply);
          });
        });
      });
    });
};

exports.removeUserFromOrg = function(request, reply) {
  if (!request.features.org_billing) {
    return reply.redirect('/org');
  }

  var orgName = request.params.org;
  var loggedInUser = request.loggedInUser.name;
  var user = {
    user: request.payload.username,
    role: request.payload.role
  };
  var opts = {};

  request.customer.getLicenseIdForOrg(orgName, function(err, licenseId) {

    if (err) {
      request.logger.error('could not get license ID for ' + orgName);
      request.logger.error(err);
      // TODO: make better error page here
      return reply.view('errors/internal', err).code(404);
    }

    request.customer.revokeSponsorship(user.user, licenseId, function(err) {

      if (err) {
        request.logger.error('issue revoking sponsorship for user ', user);
        request.logger.error(err);
        // TODO: make better error page here
        return reply.view('errors/internal', err).code(err.statusCode);
      }

      Org(loggedInUser)
        .removeUser(orgName, user.user, function(err) {
          if (err) {
            request.logger.error(err);
            return reply.view('errors/internal', err).code(err.statusCode);
          }
          return exports.getOrg(request, reply);
        });
    });
  });
};

exports.updateUserPayStatus = function(request, reply) {
  if (!request.features.org_billing) {
    return reply.redirect('/org');
  }

  var orgName = request.params.org;
  var loggedInUser = request.loggedInUser && request.loggedInUser.name;
  var payForUser = !!request.payload.payStatus;
  var username = request.payload.username

  request.customer.getLicenseIdForOrg(orgName, function(err, licenseId) {

    if (err) {
      request.logger.error('could not get license ID for ' + orgName);
      request.logger.error(err);
      // TODO: make better error page here
      return reply.view('errors/internal', err).code(404);
    }

    if (payForUser) {
      request.customer.extendSponsorship(licenseId, username, function(err, extendedSponsorship) {
        if (err) {
          if (err.message.indexOf("duplicate key value violates unique constraint") > -1) {
            return exports.getOrg(request, reply);
          }
          request.logger.error(err);
          return reply.view('errors/internal', err).code(err.statusCode);
        }
        request.customer.acceptSponsorship(extendedSponsorship.verification_key, function(err) {
          if (err) {
            request.logger.error(err);
            if (err.statusCode !== 403) {
              return reply.view('errors/internal', err).code(err.statusCode);
            }
          }

          return exports.getOrg(request, reply);
        });
      });
    } else {
      request.customer.revokeSponsorship(username, licenseId, function(err) {

        if (err) {
          request.logger.error('issue revoking sponsorship for user ', username);
          request.logger.error(err);
          // TODO: make better error page here
          return reply.view('errors/internal', err).code(err.statusCode);
        }

        return exports.getOrg(request, reply);
      });
    }
  });
};

exports.updateOrg = function(request, reply) {
  if (!request.features.org_billing) {
    return reply.redirect('/org');
  }

  if (request.payload.updateType === "addUser") {
    exports.addUserToOrg(request, reply);
  } else if (request.payload.updateType === "deleteUser") {
    exports.removeUserFromOrg(request, reply);
  } else if (request.payload.updateType === "updatePayStatus") {
    exports.updateUserPayStatus(request, reply);
  } else if (request.payload.updateType === "deleteOrg") {
    exports.deleteOrg(request, reply);
  }
};

exports.deleteOrg = function(request, reply) {
  if (!request.features.org_billing) {
    return reply.redirect('/org');
  }

  var orgToDelete = request.params.org;
  var loggedInUser = request.loggedInUser && request.loggedInUser.name;

  request.customer.getSubscriptions(function(err, subscriptions) {
    if (err) {
      return replay.view('errors/internal', err);
    }
    var subscription = subscriptions.filter(function(sub) {
      return orgToDelete === sub.npm_org;
    });

    if (subscription.length) {
      subscription = subscription[0];
    } else {
      request.logger.error("Org not in subscriptions");
      return reply.redirect('/settings/billing');
    }

    request.customer.cancelSubscription(subscription.id, function(err, sub) {
      if (err) {
        request.logger.error(err);
        return reply.view('errors/internal', err);
      }

      return reply.redirect('/settings/billing');
    });
  });


};

var orgSubscriptionSchema = {
  fullname: Joi.string().optional().allow(''),
  orgScope: Joi.string().required()
};

exports.validateOrgCreation = function(request, reply) {
  if (!request.features.org_billing) {
    return reply.redirect('/org');
  }

  var loggedInUser = request.loggedInUser.name;

  Joi.validate(request.query, orgSubscriptionSchema, function(err, planData) {
    var reportScopeInUseError = function(opts) {
      opts = opts || {};
      opts.msg = opts.msg || 'The provided org\'s @scope name is already in use';
      opts.inUseByMe = opts.inUseByMe || false;

      var err = new Error(opts.msg);

      return request.saveNotifications([
        Promise.reject(err.message)
      ]).then(function(token) {
        var url = '/org/create';
        var param = token ? "?notice=" + token : "";
        param += "&inUseError=true";
        param += opts.inUseByMe ? "&inUseByMe=" + !!opts.inUseByMe : "";
        param += planData.orgScope ? "&orgScope=" + planData.orgScope : "";
        param += planData.fullname ? "&fullname=" + planData.fullname : "";

        url = url + param;
        return reply.redirect(url);
      });
    };

    if (err) {
      return request.saveNotifications([
        Promise.reject(err.message)
      ]).then(function(token) {
        var url = '/org/create';
        var param = token ? "?notice=" + token : "";

        url = url + param;
        return reply.redirect(url);
      });

    } else {
      if (invalidUserName(planData.orgScope)) {
        var err = new Error("Org Scope must be valid name");
        return request.saveNotifications([
          Promise.reject(err.message)
        ]).then(function(token) {
          var url = '/org/create';
          var param = token ? "?notice=" + token : "";

          url = url + param;
          return reply.redirect(url);
        });
      }

      if (planData.orgScope === loggedInUser) {
        return reportScopeInUseError({
          inUseByMe: true,
          msg: 'The provided org\'s @scope name is already in use by your username'
        });
      }

      Org(loggedInUser)
        .get(planData.orgScope)
        .then(reportScopeInUseError)
        .catch(function(err) {
          if (err.statusCode === 404) {
            return User.new(request)
              .fetchFromUserACL(planData.orgScope)
              .then(reportScopeInUseError)
              .catch(function(err) {
                if (err.statusCode === 404) {
                  var url = '/org/create/billing?orgScope=' + planData.orgScope + '&fullname=' + planData.fullname;
                  return reply.redirect(url);
                } else {
                  response.logger.error(err);
                  return reply.view('errors/internal', err);
                }
              });
          } else {
            response.logger.error(err);
            return reply.view('errors/internal', err);
          }
        });
    }
  });
};