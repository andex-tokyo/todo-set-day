/**
 * Sets today's date on incomplete Google Tasks that do not have a due date.
 *
 * Prerequisites:
 * - Enable the Google Tasks API in Google Cloud.
 * - Enable the Tasks advanced Google service in Apps Script.
 */

var CONFIG = {
  maxUpdates: 50,
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
  var handler = CONFIG.targetFunctionName;
  var triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handler) {
      console.log('Deleting existing trigger for function="%s".', handler);
      ScriptApp.deleteTrigger(trigger);
    }
  });

  var newTrigger = ScriptApp.newTrigger(handler).timeBased().everyHours(1).create();
  console.log('Created hourly trigger for function="%s". triggerId="%s"', handler, newTrigger.getUniqueId());
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
  };

  console.log(
    'Starting undated task scan. dryRun=%s due="%s" maxUpdates=%s timezone="%s"',
    stats.dryRun,
    todayDue,
    options.maxUpdates,
    Session.getScriptTimeZone()
  );

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

  console.log(
    'Finished undated task scan. dryRun=%s updated=%s skipped=%s errors=%s taskListsSeen=%s tasksSeen=%s elapsedMs=%s',
    stats.dryRun,
    stats.updated,
    stats.skipped,
    stats.errors,
    stats.taskListsSeen,
    stats.tasksSeen,
    new Date().getTime() - startedAt.getTime()
  );

  return stats;
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
