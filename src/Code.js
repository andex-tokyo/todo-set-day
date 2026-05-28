/**
 * Sets today's date on incomplete Google Tasks that do not have a due date.
 *
 * Prerequisites:
 * - Enable the Google Tasks API in Google Cloud.
 * - Enable the Tasks advanced Google service in Apps Script.
 */

var CONFIG = {
  maxUpdates: 50,
  triggerEveryHours: 2,
  skipHours: {
    start: 1,
    end: 7,
  },
  excludedTaskLists: [],
  excludedTitleMarkers: ['[no-date]', '#someday'],
  targetFunctionName: 'setTodayForUndatedTasks',
};

function dryRunSetTodayForUndatedTasks() {
  return runSetTodayForUndatedTasks_({
    dryRun: true,
    maxUpdates: CONFIG.maxUpdates,
    excludedTaskLists: CONFIG.excludedTaskLists,
  });
}

function setTodayForUndatedTasks() {
  return runSetTodayForUndatedTasks_({
    dryRun: false,
    maxUpdates: CONFIG.maxUpdates,
    excludedTaskLists: CONFIG.excludedTaskLists,
  });
}

function createHourlyTrigger() {
  createTwoHourlyTrigger();
}

function createTwoHourlyTrigger() {
  var handler = CONFIG.targetFunctionName;
  var triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handler) {
      console.log('Deleting existing trigger for function="%s".', handler);
      ScriptApp.deleteTrigger(trigger);
    }
  });

  var newTrigger = ScriptApp.newTrigger(handler).timeBased().everyHours(CONFIG.triggerEveryHours).create();
  console.log(
    'Created trigger for function="%s". everyHours=%s triggerId="%s"',
    handler,
    CONFIG.triggerEveryHours,
    newTrigger.getUniqueId()
  );
}

function runSetTodayForUndatedTasks_(options) {
  var startedAt = new Date();
  var todayDue = buildTodayDue_();
  var excludedTaskLists = options.excludedTaskLists || [];
  var stats = {
    dryRun: options.dryRun === true,
    due: todayDue,
    maxUpdates: options.maxUpdates,
    taskListsSeen: 0,
    tasksSeen: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    skippedByQuietHours: false,
  };

  console.log(
    'Starting undated task scan. dryRun=%s due="%s" maxUpdates=%s timezone="%s"',
    stats.dryRun,
    todayDue,
    options.maxUpdates,
    Session.getScriptTimeZone()
  );

  if (!stats.dryRun && shouldSkipForQuietHours_()) {
    stats.skippedByQuietHours = true;
    console.log(
      'Skipping run because current hour is inside quiet hours. hour=%s skipStart=%s skipEnd=%s timezone="%s"',
      getCurrentScriptHour_(),
      CONFIG.skipHours.start,
      CONFIG.skipHours.end,
      Session.getScriptTimeZone()
    );
    logSummary_(stats, startedAt);
    return stats;
  }

  forEachTaskList_(stats, function (taskList) {
    stats.taskListsSeen += 1;

    if (isExcludedTaskList_(taskList, excludedTaskLists)) {
      stats.skipped += 1;
      console.log('Skipping excluded task list. listId="%s" title="%s"', taskList.id, taskList.title);
      return;
    }

    forEachTask_(stats, taskList, function (task) {
      processTask_(stats, options, taskList, task, todayDue);
    });
  });

  logSummary_(stats, startedAt);

  return stats;
}

function logSummary_(stats, startedAt) {
  console.log(
    'Finished undated task scan. dryRun=%s updated=%s skipped=%s errors=%s taskListsSeen=%s tasksSeen=%s skippedByQuietHours=%s elapsedMs=%s',
    stats.dryRun,
    stats.updated,
    stats.skipped,
    stats.errors,
    stats.taskListsSeen,
    stats.tasksSeen,
    stats.skippedByQuietHours,
    new Date().getTime() - startedAt.getTime()
  );
}

function processTask_(stats, options, taskList, task, todayDue) {
  stats.tasksSeen += 1;

  if (!shouldUpdateTask_(task)) {
    stats.skipped += 1;
    return;
  }

  if (stats.updated >= options.maxUpdates) {
    stats.skipped += 1;
    console.log(
      'Skipping task because max update limit was reached. listId="%s" listTitle="%s" taskId="%s" taskTitle="%s"',
      taskList.id,
      taskList.title,
      task.id,
      task.title
    );
    return;
  }

  try {
    console.log(
      '%s task due date. listId="%s" listTitle="%s" taskId="%s" taskTitle="%s" due="%s"',
      stats.dryRun ? 'Would update' : 'Updating',
      taskList.id,
      taskList.title,
      task.id,
      task.title,
      todayDue
    );

    if (!stats.dryRun) {
      Tasks.Tasks.patch({ due: todayDue }, taskList.id, task.id);
      console.log(
        'Updated task due date. listId="%s" listTitle="%s" taskId="%s" taskTitle="%s" due="%s"',
        taskList.id,
        taskList.title,
        task.id,
        task.title,
        todayDue
      );
    }

    stats.updated += 1;
  } catch (error) {
    stats.errors += 1;
    console.error(
      'Failed to update task. listId="%s" listTitle="%s" taskId="%s" taskTitle="%s" error="%s"',
      taskList.id,
      taskList.title,
      task.id,
      task.title,
      error && error.stack ? error.stack : error
    );
  }
}

function forEachTaskList_(stats, callback) {
  var pageToken;

  do {
    var response;

    try {
      response = Tasks.Tasklists.list({
        maxResults: 100,
        pageToken: pageToken,
      });
    } catch (error) {
      stats.errors += 1;
      console.error('Failed to list task lists. pageToken="%s" error="%s"', pageToken, error && error.stack ? error.stack : error);
      return;
    }

    var taskLists = response.items || [];

    taskLists.forEach(function (taskList) {
      callback(taskList);
    });

    pageToken = response.nextPageToken;
  } while (pageToken);
}

function forEachTask_(stats, taskList, callback) {
  var pageToken;

  do {
    var response;

    try {
      response = Tasks.Tasks.list(taskList.id, {
        maxResults: 100,
        pageToken: pageToken,
        showCompleted: false,
        showDeleted: false,
        showHidden: false,
      });
    } catch (error) {
      stats.errors += 1;
      console.error(
        'Failed to list tasks. listId="%s" listTitle="%s" pageToken="%s" error="%s"',
        taskList.id,
        taskList.title,
        pageToken,
        error && error.stack ? error.stack : error
      );
      return;
    }

    var tasks = response.items || [];

    tasks.forEach(function (task) {
      callback(task);
    });

    pageToken = response.nextPageToken;
  } while (pageToken);
}

function shouldUpdateTask_(task) {
  if (task.deleted || task.hidden || task.status === 'completed') {
    return false;
  }

  if (task.due) {
    return false;
  }

  return !hasExcludedTitleMarker_(task.title || '');
}

function hasExcludedTitleMarker_(title) {
  var normalizedTitle = title.toLowerCase();

  return CONFIG.excludedTitleMarkers.some(function (marker) {
    return normalizedTitle.indexOf(marker.toLowerCase()) !== -1;
  });
}

function isExcludedTaskList_(taskList, excludedTaskLists) {
  return excludedTaskLists.some(function (excluded) {
    return taskList.id === excluded || taskList.title === excluded;
  });
}

function buildTodayDue_() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return today + 'T00:00:00.000Z';
}

function shouldSkipForQuietHours_() {
  var hour = getCurrentScriptHour_();
  var start = CONFIG.skipHours.start;
  var end = CONFIG.skipHours.end;

  if (start <= end) {
    return hour >= start && hour <= end;
  }

  return hour >= start || hour <= end;
}

function getCurrentScriptHour_() {
  return Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
}
